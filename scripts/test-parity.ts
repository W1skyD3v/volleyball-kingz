/**
 * Fuzz parity: the TypeScript reducer (packages/core) and the SQL game_apply_event must agree on every
 * random event sequence: same accept/reject decision and same resulting status, score, pending, proposal.
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { PRESETS, applyEvent, newGame, type GameEvent, type GameState, type Side } from '@vk/core';

const client = new pg.Client({ database: process.env.PGDATABASE ?? 'vk_test' });
await client.connect();
const A = '00000000-0000-0000-0000-0000000000f1';
const B = '00000000-0000-0000-0000-0000000000f2';
const COURT = '10000000-0000-0000-0000-0000000000ff';
await client.query(`insert into auth.users (id) values ($1),($2) on conflict do nothing`, [A, B]);
await client.query(`insert into public.profiles (id, display_name, birth_year, is_minor) values ($1,'FuzzA',1990,false),($2,'FuzzB',1990,false) on conflict do nothing`, [A, B]);
await client.query(`insert into public.courts (id, osm_type, osm_id, lat, lng) values ($1,'way',77777,34,-118) on conflict do nothing`, [COURT]);

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const view = (s: GameState) => JSON.stringify({ status: s.status, score: s.score, pending: s.pending, proposed: s.proposed, fc: s.finalConfirmed, vr: s.voidRequest ?? null, shots: s.shots });
const sqlView = (st: Record<string, unknown>) =>
  JSON.stringify({ status: st.status, score: st.score, pending: st.pending, proposed: st.proposed, fc: st.finalConfirmed, vr: (st.voidRequest as unknown) ?? null, shots: st.shots });

let lastSqlError = "";
let steps = 0, rejected = 0, finals = 0, disputed = 0, resumed = 0;
const SEQS = Number(process.env.FUZZ_SEQS ?? 600);
for (let seq = 0; seq < SEQS; seq++) {
  const r = rng(seq + 1);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const preset = pick(PRESETS);
  const mode = pick(['live', 'quick'] as const);
  await client.query('begin');
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [A]);
  await client.query('set local role authenticated');
  const game = (await client.query(`select (public.create_game($1,'casual',1,$2,$3,array[$4::uuid],array[$5::uuid])).id as id`, [COURT, preset.id, mode, A, B])).rows[0].id;
  let ts = newGame(preset.id, mode, { lobby: true });
  for (let i = 0; i < 40 && ts.status !== 'final' && ts.status !== 'voided'; i++) {
    const side: Side = r() < 0.5 ? 'A' : 'B';
    const near = (n: number) => Math.max(0, n + Math.floor(r() * 5) - 2);
    const kinds = ['start', 'start', 'claim_point', 'claim_point', 'confirm_point', 'confirm_point', 'dispute', 'propose_final', 'confirm_proposed', 'confirm_final', 'resolve_dispute', 'resolve_dispute', 'void', 'void'];
    const kind = pick(kinds);
    const score = { A: near(preset.target + (r() < 0.5 ? 0 : 1)), B: near(r() < 0.5 ? preset.target - 3 : preset.target) };
    // Prefer the "natural" reply to a pending claim/proposal so sequences make progress.
    let ev = (
      kind === 'start' ? { type: kind }
      : kind === 'claim_point' ? { type: kind, side, points: 1 + Math.floor(r() * 3), ...(r() < 0.4 ? { scorer: side === 'A' ? A : B } : {}) }
      : kind === 'dispute' ? { type: kind, side, reason: 'x' }
      : kind === 'propose_final' || kind === 'resolve_dispute' ? { type: kind, side, score }
      : { type: kind, side }
    ) as GameEvent;
    // 70% of the time play a plausible move so sequences reach confirmations, disputes and finals.
    if (r() < 0.7 && ts.status !== 'lobby') {
      const o: Side = side === 'A' ? 'B' : 'A';
      const natural: GameEvent[] = [];
      if (ts.pending) natural.push({ type: 'confirm_point', side: ts.pending.by === 'A' ? 'B' : 'A' });
      else if (ts.proposed) natural.push({ type: 'confirm_proposed', side: ts.proposed.by === 'A' ? 'B' : 'A' });
      else if (ts.status === 'awaiting_final') natural.push({ type: 'confirm_final', side }, { type: 'confirm_final', side: o });
      else if (ts.status === 'disputed') {
        const agreed = { A: near(preset.target), B: near(preset.target - 2) };
        natural.push({ type: 'resolve_dispute', side: 'A', score: agreed }, { type: 'resolve_dispute', side: 'B', score: agreed });
      } else if (mode === 'live') natural.push({ type: 'claim_point', side, points: preset.scoring === 'ones' ? 1 : 1 + Math.floor(r() * 2), ...(r() < 0.5 ? { scorer: side === 'A' ? A : B } : {}) });
      else natural.push({ type: 'propose_final', side, score: { A: preset.target + (r() < 0.3 ? 1 : 0), B: Math.floor(r() * preset.target) } });
      if (r() < 0.06) natural.push({ type: 'dispute', side, reason: 'x' });
      ev = pick(natural);
    }

    let tsErr = false;
    let next = ts;
    try { next = applyEvent(ts, { ...ev, at: 0 }); } catch { tsErr = true; }

    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, ['side' in ev ? ((ev as { side: Side }).side === 'A' ? A : B) : B]);
    await client.query('savepoint s');
    const { side: _s, type, ...rest } = ev as GameEvent & { side: Side };
    void _s;
    let sqlErr = false;
    try {
      // 'start' is the TS name for "the last player accepted"; the server does it through accept_game as player B.
      if (type === 'start') await client.query('select public.accept_game($1)', [game]);
      else await client.query(`select public.game_apply_event($1, $2::jsonb)`, [game, JSON.stringify({ type, ...rest })]);
    } catch (e) { sqlErr = true; lastSqlError = (e as Error).message; await client.query('rollback to savepoint s'); }
    steps++;
    assert.equal(sqlErr, tsErr, `seq ${seq} step ${i}: ${JSON.stringify(ev)} on ${preset.id}/${mode}: ts ${tsErr ? 'rejected' : 'accepted'}, sql ${sqlErr ? `rejected (${lastSqlError})` : "accepted"}, ts state before: ${view(ts)}`);
    if (tsErr) { rejected++; continue; }
    if (next.status === 'disputed') disputed++;
    if (ts.status === 'disputed' && next.status !== 'disputed') resumed++;
    ts = next;
    const st = (await client.query('select state from public.games where id = $1', [game])).rows[0].state;
    assert.equal(sqlView(st), view(ts), `seq ${seq} step ${i}: state diverged after ${JSON.stringify(ev)} on ${preset.id}/${mode}`);
  }
  if (ts.status === 'final') finals++;
  await client.query('rollback');
}
console.log(`parity ok: ${SEQS} sequences, ${steps} events (${rejected} rejected by both), ${finals} reached final, ${disputed} disputes, ${resumed} resumed`);
await client.end();
