import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';

const SECRET = 'load-secret-load-secret-load-secret-1234';
const DB = process.env.PGDATABASE ?? 'vk_load';
const PORT = 3397;
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new pg.Pool({ database: DB, max: 4 });
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const b64 = (x: object) => Buffer.from(JSON.stringify(x)).toString('base64url');
const jwt = (n: number) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ sub: id(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
};
const bin = process.env.POSTGREST_BIN;
if (!bin) throw new Error('set POSTGREST_BIN');
const pgrst = spawn(bin, [], { env: { ...process.env, PGRST_DB_URI: `postgresql://authenticator@/${DB}?host=${process.env.PGHOST ?? '/tmp'}&port=${process.env.PGPORT ?? '54329'}`, PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: SECRET, PGRST_SERVER_PORT: String(PORT), PGRST_DB_POOL: '10', PGRST_DB_MAX_ROWS: '1000' }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`${BASE}/`)).status < 500) break; } catch { /* not up */ }
  await new Promise((r) => setTimeout(r, 200));
}
const N = 200;
for (let i = 1; i <= N; i++) await pool.query('insert into auth.users (id) values ($1) on conflict do nothing', [id(i)]);
await pool.query(`insert into public.profiles (id, display_name, birth_year, is_minor) select id, 'Player ' || right(id::text, 4), 1990, false from auth.users on conflict do nothing`);
const call = (path: string, n: number, body?: unknown) => fetch(`${BASE}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt(n)}` }, body: body === undefined ? undefined : JSON.stringify(body) });

async function scenario(name: string, total: number, concurrency: number, fn: (i: number) => Promise<Response>) {
  const lat: number[] = [];
  let errors = 0;
  let next = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < total) {
      const i = next++;
      const s = performance.now();
      try { const r = await fn(i); await r.arrayBuffer(); if (r.status >= 400) errors++; } catch { errors++; }
      lat.push(performance.now() - s);
    }
  }));
  const secs = (performance.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  const pct = (p: number) => lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))]!.toFixed(0);
  console.log(`${name.padEnd(34)} ${String(total).padStart(5)} req @${String(concurrency).padStart(3)} concurrent  ${(total / secs).toFixed(0).padStart(5)} req/s  p50 ${pct(50).padStart(4)} ms  p95 ${pct(95).padStart(4)} ms  p99 ${pct(99).padStart(4)} ms  errors ${errors}`);
  return { p95: Number(pct(95)), errors };
}

const results = [];
results.push(await scenario('courts near me (PostGIS)', 600, 40, (i) => call('/rpc/courts_near', 1 + (i % N), { p_lat: 34.05 + (i % 20) * 0.01, p_lng: -118.25, p_radius_m: 15000, p_limit: 50 })));
results.push(await scenario('closet (starter pack grant)', 600, 40, (i) => call('/rpc/my_closet', 1 + (i % N), {})));
results.push(await scenario('court headcounts', 400, 40, (i) => call('/rpc/court_headcounts', 1 + (i % N), {})));
results.push(await scenario('leaderboard (public)', 400, 40, () => fetch(`${BASE}/rpc/leaderboard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p_tier: 1, p_limit: 50 }) })));
const court = (await pool.query('select id from public.courts limit 1')).rows[0].id;
for (let i = 1; i <= N; i++) await pool.query(`insert into public.check_ins (user_id, court_id, distance_m, expires_at) values ($1,$2,1,now() + interval '1 hour') on conflict do nothing`, [id(i), court]).catch(() => undefined);
results.push(await scenario('headcounts with 200 check-ins', 400, 40, (i) => call('/rpc/court_headcounts', 1 + (i % N), {})));
// a hundred simultaneous games, each scored to the end (the heaviest path: server-side game state + rating on finalize)
const gameIds: string[] = [];
for (let g = 0; g < 100; g++) {
  const r = await (await call('/rpc/create_game', 1 + g * 2, { p_court: court, p_lane: 'casual', p_tier: 1, p_preset: '7-1s-w1', p_mode: 'live', p_side_a: [id(1 + g * 2)], p_side_b: [id(2 + g * 2)] })).json();
  gameIds.push(typeof r === 'string' ? r : r.id);
  await call('/rpc/accept_game', 2 + g * 2, { p_game: gameIds[g] });
}
let scored = 0;
results.push(await scenario('100 games scored to 7 (claim+confirm)', 100 * 14, 40, async (i) => {
  const g = i % 100;
  const turn = Math.floor(i / 100); // 0..13: claim, confirm, claim, confirm...
  const claimer = 1 + g * 2;
  const r = turn % 2 === 0 ? await call('/rpc/game_apply_event', claimer, { p_game: gameIds[g], p_event: { type: 'claim_point', points: 1 } }) : await call('/rpc/game_apply_event', claimer + 1, { p_game: gameIds[g], p_event: { type: 'confirm_point' } });
  if (r.status < 300) scored++;
  return r;
}));
const finals = (await pool.query(`select count(*)::int n from public.games where status in ('awaiting_final','final')`)).rows[0].n;
console.log(`games that reached the end of play: ${finals} of 100 (${scored} accepted events)`);
const bad = results.filter((r) => r.errors > 0 || r.p95 > 1500);
pgrst.kill();
await pool.end();
console.log(bad.length ? `SLOW OR FAILING scenarios: ${bad.length}` : 'all scenarios healthy (no errors, p95 under 1.5 s)');
process.exit(bad.length ? 1 : 0);
