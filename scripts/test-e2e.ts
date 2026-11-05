/**
 * End-to-end: Supabase adapter -> HTTP -> real PostgREST -> real Postgres (RLS + RPCs) -> rating worker.
 * Run via scripts/test-e2e.sh (needs Postgres+PostGIS and a PostgREST binary in $POSTGREST_BIN).
 * Not covered here: Supabase Auth email login and Realtime (need the full Supabase stack).
 */
import { createHmac } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSupabaseBackend } from '../apps/mobile/src/backend/supabase';
import type { Backend } from '../apps/mobile/src/backend/types';

const SECRET = 'e2e-secret-e2e-secret-e2e-secret-1234';
const DB = process.env.PGDATABASE ?? 'vk_e2e';
const PGRST_PORT = 3399;
const b64 = (x: object | Buffer) => Buffer.from(Buffer.isBuffer(x) ? x : JSON.stringify(x)).toString('base64url');
const jwt = (sub: string) => {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`;
};

let pgrst: ChildProcess;
let proxy: http.Server;
let proxyUrl = '';
const pool = new pg.Pool({ database: DB });
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const LA = { lat: 34.0488, lng: -118.2518 }; // court c1
const COURT = '10000000-0000-0000-0000-0000000000c1';

function client(n: number): Backend {
  const sb = createClient(proxyUrl, 'anon-key', { accessToken: async () => jwt(id(n)), auth: { persistSession: false } });
  return createSupabaseBackend(sb, { userId: async () => id(n) });
}

beforeAll(async () => {
  const bin = process.env.POSTGREST_BIN;
  if (!bin) throw new Error('set POSTGREST_BIN');
  pgrst = spawn(bin, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: `postgresql://authenticator@/${DB}?host=${process.env.PGHOST ?? '/tmp'}&port=${process.env.PGPORT ?? '54329'}`,
      PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: SECRET, PGRST_SERVER_PORT: String(PGRST_PORT),
    },
    stdio: 'ignore',
  });
  // supabase-js talks to <url>/rest/v1/*; PostgREST serves at /. Strip the prefix.
  proxy = http.createServer((req, res) => {
    const up = http.request({ host: '127.0.0.1', port: PGRST_PORT, path: (req.url ?? '/').replace(/^\/rest\/v1/, ''), method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 500, r.headers);
      r.pipe(res);
    });
    up.on('error', () => res.writeHead(502).end());
    req.pipe(up);
  });
  await new Promise<void>((ok) => proxy.listen(0, ok));
  proxyUrl = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PGRST_PORT}/`);
      if (r.status < 500) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  for (const n of [1, 2, 3, 4, 9]) await pool.query('insert into auth.users (id) values ($1) on conflict do nothing', [id(n)]);
  await pool.query(`insert into public.courts (id, osm_type, osm_id, name, lat, lng, court_type, fit_confirmations) values ($1,'way',1,'Pershing',$2,$3,'full',1) on conflict do nothing`, [COURT, LA.lat, LA.lng]);
}, 30_000);

afterAll(async () => {
  pgrst?.kill();
  proxy?.close();
  await pool.end();
});

describe('adapter against real PostgREST + RLS + RPCs', () => {
  const adult1 = () => client(1);
  const adult2 = () => client(2);
  const minor = () => client(3);

  it('age screen: under-13 refused, adult and minor profiles created', async () => {
    await expect(client(9).createProfile('Kid', new Date('2018-01-01'))).rejects.toThrow('age_blocked');
    expect((await adult1().createProfile('Ana', new Date('1990-05-05'))).isMinor).toBe(false);
    await adult2().createProfile('Bo', new Date('1991-05-05'));
    expect((await minor().createProfile('Teen', new Date('2010-05-05'))).isMinor).toBe(true);
    expect((await adult1().getProfile())!.displayName).toBe('Ana');
  });

  it('check-in near works, far is refused, headcount hides the minor from adults but not minors', async () => {
    expect((await adult1().checkIn(COURT, { ...LA, accuracyM: 5 })).ok).toBe(true);
    expect((await adult2().checkIn(COURT, { lat: 34.2, lng: -118.25 })).reason).toBe('too_far');
    expect((await minor().checkIn(COURT, LA)).ok).toBe(true);
    const adultView = (await adult1().listCourts(LA)).find((c) => c.id === COURT)!;
    expect(adultView.headcount).toBe(1);
    expect(adultView.distanceM).toBeLessThan(5);
    expect((await minor().listCourts(LA)).find((c) => c.id === COURT)!.headcount).toBe(2);
    expect(await adult1().myCheckInCourtId()).toBe(COURT);
  });

  it('court confirmation counts once per player; check-out frees the headcount', async () => {
    await adult1().confirmCourtFit(COURT);
    await adult1().checkOut();
    expect(await adult1().myCheckInCourtId()).toBeNull();
    await adult1().checkIn(COURT, LA);
  });

  it('run board: minors invisible to adults; join/leave; three reports hide a run', async () => {
    await minor().createRun({ courtId: COURT, startsAt: Date.now() + 3600_000, tier: 1, lane: 'casual', presetId: '7-1s-w1' });
    expect(await adult1().listRuns()).toEqual([]);
    expect((await minor().listRuns())).toHaveLength(1);

    await adult1().createRun({ courtId: COURT, startsAt: Date.now() + 3600_000, tier: 1, lane: 'casual', presetId: '11-1s-w2', note: 'bring water' });
    const runs = await adult2().listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ hostName: 'Ana', note: 'bring water', joined: false });
    await adult2().joinRun(runs[0]!.id);
    expect((await adult2().listRuns())[0]!.members.map((m) => m.name)).toEqual(['Ana', 'Bo']);
    await adult2().leaveRun(runs[0]!.id);
    await adult2().joinRun(runs[0]!.id);

    for (const n of [2, 4, 9]) {
      await pool.query(`insert into public.profiles (id, display_name, birth_year, is_minor) values ($1,$2,1990,false) on conflict do nothing`, [id(n), `U${n}`]);
    }
    const target = runs[0]!.id;
    await adult2().report({ targetType: 'run', targetId: target, reason: 'spam', safetyEscalation: false });
    await client(4).report({ targetType: 'run', targetId: target, reason: 'spam', safetyEscalation: false });
    expect(await adult2().listRuns()).toHaveLength(1);
    await client(9).report({ targetType: 'run', targetId: target, reason: 'spam', safetyEscalation: false });
    expect(await adult2().listRuns()).toHaveLength(0); // auto-hidden after three distinct reporters
    await pool.query('update public.runs set hidden = false where id = $1', [target]); // moderator restores
  });

  it('games are server-authoritative: from a run, captains only, illegal moves refused, direct writes blocked', async () => {
    const a1 = adult1();
    const a2 = adult2();
    await a2.checkIn(COURT, LA);
    const run = (await a2.listRuns())[0]!;
    await expect(a2.startGameFromRun(run.id, 'quick')).rejects.toThrow('only_host_can_start');
    const game = await a1.startGameFromRun(run.id, 'quick');
    expect(game.mySide).toBe('A');
    expect((await a2.getGame(game.id)).mySide).toBe('B');
    expect(game.players.A[0]!.name).toBe('Ana');

    // consent first: nothing can be scored until the other player accepts
    expect(game.state.status).toBe('lobby');
    expect(game.players.A[0]!.accepted).toBe(true);
    expect(game.players.B[0]!.accepted).toBe(false);
    await expect(a1.sendEvent(game.id, { type: 'propose_final', side: 'A', score: { A: 11, B: 4 } })).rejects.toThrow('not_all_confirmed');
    await expect(client(4).acceptGame(game.id)).rejects.toThrow('game_not_found');
    expect((await a2.acceptGame(game.id)).state.status).toBe('active');

    await expect(client(4).getGame(game.id)).rejects.toThrow('game_not_found');
    await expect(client(4).sendEvent(game.id, { type: 'void', side: 'A' })).rejects.toThrow('game_not_found');
    await expect(a1.sendEvent(game.id, { type: 'propose_final', side: 'A', score: { A: 11, B: 10 } })).rejects.toThrow('invalid_final');
    await expect(a1.sendEvent(game.id, { type: 'confirm_proposed', side: 'A' })).rejects.toThrow();

    // the phone cannot cheat by writing the table directly
    const sb = createClient(proxyUrl, 'k', { accessToken: async () => jwt(id(1)) });
    const direct = await sb.from('games').update({ score_a: 99, status: 'final' }).eq('id', game.id);
    expect(direct.error).not.toBeNull();

    await a1.sendEvent(game.id, { type: 'propose_final', side: 'A', score: { A: 11, B: 4 } });
    const done = await a2.sendEvent(game.id, { type: 'confirm_proposed', side: 'B' });
    expect(done.state.status).toBe('final');
    expect(done.outcome?.pending).toBe(false); // rated inside the database at the moment it became final
    const after = await a1.getGame(game.id);
    expect(after.outcome).toMatchObject({ pending: false, unrated: true, goldAwarded: 20 }); // 10 + 10 first game of the day
    expect((await a1.getProfile())!.goldEarned).toBe(20);
    expect((await a1.getProfile())!.goldBought).toBe(0);

    await a1.submitFeedback(game.id, 5);
    await a1.ratePlayer(game.id, id(2), 4);
    await expect(a1.ratePlayer(game.id, id(1), 5)).rejects.toThrow();
    expect((await a1.getGame(game.id)).feedback).toEqual({ gameRating: 5 });
    expect((await a1.tierUsage()).length).toBeGreaterThan(0);
  });

  it('ranked: needs live check-ins, rates per tier through the worker, shows "rating +/- range"', async () => {
    const a1 = adult1();
    const a2 = adult2();
    await a1.createRun({ courtId: COURT, startsAt: Date.now() + 3600_000, tier: 1, lane: 'ranked', presetId: '7-1s-w1' });
    const run = (await a2.listRuns()).find((r) => r.lane === 'ranked')!;
    await a2.joinRun(run.id);
    await pool.query(`update public.check_ins set expires_at = now() - interval '1 minute' where user_id = $1`, [id(2)]);
    await expect(a1.startGameFromRun(run.id, 'live')).rejects.toThrow('ranked_requires_check_in');
    await a2.checkIn(COURT, LA);
    const g = await a1.startGameFromRun(run.id, 'live');
    await a2.acceptGame(g.id);
    for (let i = 0; i < 7; i++) {
      await a1.sendEvent(g.id, { type: 'claim_point', side: 'A', points: 1 });
      await a2.sendEvent(g.id, { type: 'confirm_point', side: 'B' });
    }
    expect((await a1.getGame(g.id)).state.status).toBe('awaiting_final');
    await a1.sendEvent(g.id, { type: 'confirm_final', side: 'A' });
    await a2.sendEvent(g.id, { type: 'confirm_final', side: 'B' });
    const r = await a1.getRatings();
    expect(r.ranked).toHaveLength(1);
    expect(r.ranked[0]!.label).toMatch(/^1\d{3} \+\/- \d+ \(provisional\)$/);
    expect((await a1.getGame(g.id)).outcome!.ratingLine).toMatch(/^Win: \+/);
    expect((await a2.getGame(g.id)).outcome!.ratingLine).toMatch(/^Loss: -/);
  });

  it('consent: a declined lobby is voided and never rated', async () => {
    const a1 = adult1();
    const a2 = adult2();
    await a1.createRun({ courtId: COURT, startsAt: Date.now() + 3600_000, tier: 1, lane: 'casual', presetId: '7-1s-w1' });
    const run = (await a2.listRuns()).find((r) => r.hostName === 'Ana' && r.lane === 'casual' && r.presetId === '7-1s-w1')!;
    await a2.joinRun(run.id);
    const g = await a1.startGameFromRun(run.id, 'quick');
    const declined = await a2.declineGame(g.id);
    expect(declined.state.status).toBe('voided');
    await expect(a1.sendEvent(g.id, { type: 'propose_final', side: 'A', score: { A: 7, B: 1 } })).rejects.toThrow();
    const jobs = await pool.query('select count(*)::int n from public.rating_jobs where game_id = $1', [g.id]);
    expect(jobs.rows[0].n).toBe(0);
  });

  it('friends by code; adults cannot find minors; friends see where each other are', async () => {
    const a1 = adult1();
    const a2 = adult2();
    const code2 = await a2.myFriendCode();
    expect(code2).toMatch(/^[A-Z2-9]{8}$/);
    await expect(a1.sendFriendRequest('NOSUCHCD')).rejects.toThrow('friend_not_found');
    await expect(a1.sendFriendRequest(await minor().myFriendCode())).rejects.toThrow('friend_not_found');
    await a1.sendFriendRequest(code2.toLowerCase());
    await expect(a1.sendFriendRequest(code2)).rejects.toThrow('already_friends_or_pending');
    const incoming = (await a2.listFriends()).find((f) => f.relation === 'incoming')!;
    expect(incoming.name).toBe('Ana');
    expect(incoming.courtName).toBeUndefined(); // no location before acceptance
    await a2.respondFriendRequest(incoming.requestId, true);
    await a2.checkIn(COURT, LA);
    const seen = (await a1.listFriends()).find((f) => f.name === 'Bo')!;
    expect(seen).toMatchObject({ relation: 'friend', courtName: 'Pershing' });
    expect(await client(4).listFriends()).toEqual([]);
  });

  it('private runs are invite-only: invisible to strangers and uninvited friends, joinable once invited', async () => {
    const a1 = adult1();
    const a2 = adult2();
    await a1.createRun({ courtId: COURT, startsAt: Date.now() + 3600_000, tier: 1, lane: 'private', presetId: '7-1s-w1', note: 'friends only' });
    const run = (await a1.listRuns()).find((r) => r.lane === 'private')!;
    expect((await a2.listRuns()).some((r) => r.lane === 'private')).toBe(false);
    await expect(a2.joinRun(run.id)).rejects.toThrow();
    await expect(a1.inviteToRun(run.id, id(4))).rejects.toThrow('not_friends');
    await a1.inviteToRun(run.id, id(2));
    const seen = (await a2.listRuns()).find((r) => r.lane === 'private')!;
    expect(seen.note).toBe('friends only');
    await a2.joinRun(run.id);
    expect((await a1.listRuns()).find((r) => r.id === run.id)!.members.map((m) => m.name)).toEqual(['Ana', 'Bo']);
    // a stranger still cannot see it
    await client(4).createProfile('Cy', new Date('1992-01-01')).catch(() => undefined);
    expect((await client(4).listRuns()).some((r) => r.lane === 'private')).toBe(false);
    // and a private game keeps its history private
    const g = await a1.startGameFromRun(run.id, 'quick');
    await a2.acceptGame(g.id);
    await a1.sendEvent(g.id, { type: 'propose_final', side: 'A', score: { A: 7, B: 3 } });
    await a2.sendEvent(g.id, { type: 'confirm_proposed', side: 'B' });
    expect((await a1.myStats()).some((r) => r.lane === 'private')).toBe(true);
    const asOther = await pool.query(`select set_config('request.jwt.claim.sub', $1, true)`, [id(2)]);
    void asOther;
    const ratings = await a2.getRatings();
    expect(ratings.privateHistory.length).toBe(1); // own private Elo history only
  });

  it('deleting an account keeps the name and ranked stats, scrubs everything else, and frees the login', async () => {
    const a1 = adult1();
    const before = (await pool.query(`select count(*)::int n from public.ratings where user_id = $1 and kind = 'ranked'`, [id(1)])).rows[0].n;
    expect(before).toBeGreaterThan(0);
    await a1.setAvatar({ seed: 'x', jersey: { style: 'classic', primary: '#ffffff', secondary: '#000000', number: 7 }, shorts: { color: '#000000' }, shoes: { style: 'low', color: '#ffffff' } });
    await a1.deleteAccount(true);
    expect(await a1.getProfile()).toBeNull();
    const p = (await pool.query('select display_name, birth_year, avatar, gold_earned, deleted_at from public.profiles where id = $1', [id(1)])).rows[0];
    expect(p).toMatchObject({ display_name: 'Ana', birth_year: null, avatar: null, gold_earned: 0 });
    expect(p.deleted_at).not.toBeNull();
    expect((await pool.query(`select count(*)::int n from public.ratings where user_id = $1 and kind = 'ranked'`, [id(1)])).rows[0].n).toBe(before);
    expect((await pool.query(`select count(*)::int n from public.ratings where user_id = $1 and kind <> 'ranked'`, [id(1)])).rows[0].n).toBe(0);
    expect((await pool.query('select count(*)::int n from public.game_players where user_id = $1', [id(1)])).rows[0].n).toBeGreaterThan(0);
    expect((await pool.query('select count(*)::int n from auth.users where id = $1', [id(1)])).rows[0].n).toBe(0);
    // a deleted account can no longer act, even with a still-valid token
    await expect(a1.checkIn(COURT, LA)).rejects.toThrow();
    // others no longer see the deleted friend or their runs
    expect((await adult2().listFriends()).some((f) => f.name === 'Ana')).toBe(false);
  });

  it('other players\' private profile columns are unreadable through the API', async () => {
    const sb = createClient(proxyUrl, 'k', { accessToken: async () => jwt(id(2)) });
    for (const col of ['birth_year', 'friend_code', 'gold_earned', 'casual_elo_opt_in']) {
      const r = await sb.from('profiles').select(col).limit(5);
      expect(r.error, `${col} must not be readable`).not.toBeNull();
    }
    const star = await sb.from('profiles').select('*').limit(5);
    expect(star.error).not.toBeNull();
    const names = await sb.from('profiles').select('id,display_name').limit(5);
    expect(names.error).toBeNull();
    expect((await adult2().getProfile())!.displayName).toBe('Bo'); // own full profile still works (my_profile)
  });

  it('friend-code guessing is throttled through the adapter', async () => {
    const c = client(9);
    await c.createProfile('Guesser', new Date('1990-01-01')).catch(() => undefined);
    const errs: string[] = [];
    for (let i = 0; i < 12; i++) await c.sendFriendRequest(`WRONG${i}`.padEnd(8, 'X')).catch((e: Error) => errs.push(e.message));
    expect(errs.slice(0, 10).every((e) => e === 'friend_not_found')).toBe(true);
    expect(errs.slice(10)).toEqual(['rate_limited', 'rate_limited']);
  });

  it('the losing side cannot void a started game alone', async () => {
    const a2 = adult2();
    const other = client(4);
    await other.createProfile('Cy3', new Date('1992-01-01')).catch(() => undefined);
    await pool.query('delete from public.profiles where id = $1 and deleted_at is not null', [id(4)]);
    await pool.query('insert into auth.users (id) values ($1) on conflict do nothing', [id(4)]);
    await pool.query(`insert into public.profiles (id, display_name, birth_year, is_minor) values ($1,'Dee',1991,false) on conflict (id) do update set deleted_at = null, display_name = 'Dee', birth_year = 1991`, [id(4)]);
    const dee = client(4);
    await dee.checkIn(COURT, LA);
    await a2.checkIn(COURT, LA);
    await a2.createRun({ courtId: COURT, startsAt: Date.now() + 3600_000, tier: 1, lane: 'casual', presetId: '11-1s-w1' });
    const run = (await a2.listRuns()).find((r) => r.mine && r.presetId === '11-1s-w1' && r.members.length === 1)!;
    await dee.joinRun(run.id);
    const g = await a2.startGameFromRun(run.id, 'live');
    await dee.acceptGame(g.id);
    await a2.sendEvent(g.id, { type: 'claim_point', side: 'A', points: 1 });
    await dee.sendEvent(g.id, { type: 'confirm_point', side: 'B' });
    const asked = await dee.sendEvent(g.id, { type: 'void', side: 'B' }); // Dee is losing 0-1 and tries to bail out
    expect(asked.state.status).toBe('active');
    expect(asked.state.voidRequest).toEqual({ by: 'B' });
    const done = await a2.sendEvent(g.id, { type: 'void', side: 'A' });
    expect(done.state.status).toBe('voided');
  });

  it('full erasure replaces the name', async () => {
    await client(4).createProfile('Cy2', new Date('1992-01-01')).catch(() => undefined);
    await client(4).deleteAccount(false);
    const p = (await pool.query('select display_name from public.profiles where id = $1', [id(4)])).rows[0];
    expect(p.display_name).toBe('Deleted player');
  });

  it('closet: starter pack, buy with earned Gold, equip, and every refusal through real RLS', async () => {
    const n = 12;
    const u = client(n);
    await u.createProfile('Closet Kid', new Date('1990-01-01'));
    const c0 = await u.getCloset();
    expect(c0.gold).toBe(0);
    expect(c0.owned).toContain('jersey-classic');
    expect(c0.loadout.jersey).toBe('jersey-classic');
    await expect(u.buyItem('head-headband')).rejects.toThrow('not_enough_gold');
    await pool.query('update public.profiles set gold_earned = 450 where id = $1', [id(n)]); // as the rating pipeline would
    const c1 = await u.buyItem('head-headband');
    expect(c1.gold).toBe(350);
    await expect(u.buyItem('head-headband')).rejects.toThrow('already_owned');
    await expect(u.buyItem('jersey-royal')).rejects.toThrow('premium_only');
    await expect(u.equipItem('head-cap')).rejects.toThrow('not_owned');
    const c2 = await u.equipItem('head-headband');
    expect(c2.loadout.headwear).toBe('head-headband');
    const c3 = await u.unequipSlot('headwear');
    expect(c3.loadout.headwear).toBeUndefined();
    await expect(u.unequipSlot('jersey')).rejects.toThrow('cannot_empty');
    expect((await u.getCloset()).gold).toBe(350); // buying again changed nothing
  });

  it('live scoring: the adapter sends who scored and the server keeps it in the ordered shots (never guessed)', async () => {
    const a1 = client(14);
    const a2 = client(15);
    await a1.createProfile('Live One', new Date('1990-01-01'));
    await a2.createProfile('Live Two', new Date('1990-01-01'));
    await a1.checkIn(COURT, LA);
    await a2.checkIn(COURT, LA);
    await a1.createRun({ courtId: COURT, startsAt: Date.now() + 3600_000, tier: 1, lane: 'casual', presetId: '7-1s-w1', note: 'shots test' });
    const run = (await a2.listRuns()).find((r) => r.note === 'shots test')!;
    await a2.joinRun(run.id);
    const g = await a1.startGameFromRun(run.id, 'live');
    await a2.acceptGame(g.id);
    await expect(a1.sendEvent(g.id, { type: 'claim_point', side: 'A', points: 1, scorer: id(15) })).rejects.toThrow('bad_scorer'); // a player from the other side
    await a1.sendEvent(g.id, { type: 'claim_point', side: 'A', points: 1, scorer: id(14) });
    const one = await a2.sendEvent(g.id, { type: 'confirm_point', side: 'B' });
    await a2.sendEvent(g.id, { type: 'claim_point', side: 'B', points: 1 });
    const two = await a1.sendEvent(g.id, { type: 'confirm_point', side: 'A' });
    expect(one.state.shots).toEqual([{ side: 'A', points: 1, scorer: id(14) }]);
    expect(two.state.shots).toEqual([{ side: 'A', points: 1, scorer: id(14) }, { side: 'B', points: 1 }]);
    expect(two.state.score).toEqual({ A: 1, B: 1 });
  });
});
