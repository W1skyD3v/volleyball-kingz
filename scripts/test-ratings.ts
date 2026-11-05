/** Integration test of the in-database rating pipeline (migration 9) against a real Postgres (see scripts/test-db.sh). */
import assert from 'node:assert/strict';
import pg from 'pg';

const pool = new pg.Pool({ database: process.env.PGDATABASE ?? 'vk_test' });
const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const COURT = '10000000-0000-0000-0000-0000000000aa';
let gameSeq = 0;

async function q(sql: string, p: unknown[] = []) {
  return (await pool.query(sql, p)).rows;
}
async function mkUser(n: number, optIn = false) {
  await q('insert into auth.users (id) values ($1) on conflict do nothing', [uuid(n)]);
  await q('insert into public.profiles (id, display_name, birth_year, is_minor, casual_elo_opt_in) values ($1,$2,1990,false,$3) on conflict do nothing', [uuid(n), `P${n}`, optIn]);
}
async function finalGame(lane: string, tier: number, a: number[], b: number[], scoreA: number, scoreB: number) {
  const id = `30000000-0000-0000-0000-${String(++gameSeq).padStart(12, '0')}`;
  await q(`insert into public.games (id, court_id, lane, tier, preset_id, mode, status, state, created_by) values ($1,$2,$3,$4,'11-1s-w2','quick','active','{}',$5)`, [id, COURT, lane, tier, uuid(a[0]!)]);
  for (const x of a) await q(`insert into public.game_players (game_id, user_id, side, is_captain, accepted_at) values ($1,$2,'A',$3, now())`, [id, uuid(x), x === a[0]]);
  for (const x of b) await q(`insert into public.game_players (game_id, user_id, side, is_captain, accepted_at) values ($1,$2,'B',$3, now())`, [id, uuid(x), x === b[0]]);
  await q(`update public.games set status = 'final', score_a = $2, score_b = $3, finalized_at = now() where id = $1`, [id, scoreA, scoreB]); // the trigger rates it right here
  return id;
}
const ranked = async (u: number, tier = 1) => (await q(`select * from public.ratings where user_id = $1 and tier = $2 and kind = 'ranked'`, [uuid(u), tier]))[0];

let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message}`);
  }
}

await q(`insert into public.courts (id, osm_type, osm_id, lat, lng, court_type) values ($1,'way',9999,34.05,-118.24,'full') on conflict do nothing`, [COURT]);
for (let i = 1; i <= 8; i++) await mkUser(i, i === 7);

await test('finalizing a game rates it immediately and exactly once (no worker, no queue to drain)', async () => {
  const id = await finalGame('casual', 1, [1], [2], 11, 5);
  const job = (await q('select processed_at, error from public.rating_jobs where game_id = $1', [id]));
  assert.equal(job.length, 1);
  assert.notEqual(job[0].processed_at, null);
  assert.equal(job[0].error, null);
  assert.equal((await q('select public.retry_rating_jobs() n'))[0].n, 0); // nothing left to retry
  await q(`update public.games set score_a = 12 where id = $1`, [id]); // touching a final game again must not re-rate it
  assert.equal((await q('select count(*)::int n from public.gold_ledger where game_id = $1', [id]))[0].n, 4); // base + first-game bonus, per player
});

await test('casual: no rating by default, Gold awarded (10 + 10 first game of the day)', async () => {
  assert.equal((await q(`select count(*)::int n from public.ratings where user_id in ($1,$2)`, [uuid(1), uuid(2)]))[0].n, 0);
  assert.equal((await q('select gold_earned from public.profiles where id = $1', [uuid(1)]))[0].gold_earned, 20);
  assert.equal((await q('select gold_bought from public.profiles where id = $1', [uuid(1)]))[0].gold_bought, 0);
});

await test('casual opt-in: separate Casual Elo moves for the opted-in player only; ranked untouched', async () => {
  await finalGame('casual', 1, [7], [3], 11, 4);
  const r = await q(`select user_id, kind, elo from public.ratings where tier = 1 and user_id in ($1,$2)`, [uuid(7), uuid(3)]);
  assert.equal(r.length, 1);
  assert.equal(r[0].user_id, uuid(7));
  assert.equal(r[0].kind, 'casual_elo');
  assert.ok(r[0].elo > 1200);
  assert.equal(await ranked(7), undefined);
});

await test('private: Elo history event per player', async () => {
  const id = await finalGame('private', 1, [4], [5], 11, 9);
  const ev = await q(`select user_id, kind, before_rating, after_rating from public.rating_events where game_id = $1 order by user_id`, [id]);
  assert.equal(ev.length, 2);
  assert.ok(ev[0].after_rating > ev[0].before_rating); // winner (4)
  assert.ok(ev[1].after_rating < ev[1].before_rating);
});

await test('ranked: Plackett-Luce moves winners up, losers down, per tier, with a reason line', async () => {
  const id = await finalGame('ranked', 2, [1, 2], [3, 4], 11, 6);
  const w = await ranked(1, 2);
  const l = await ranked(3, 2);
  assert.ok(w.mu > 25 && l.mu < 25);
  assert.equal(await ranked(1, 1), undefined); // other tier untouched
  const ev = (await q(`select reason from public.rating_events where game_id = $1 and user_id = $2`, [id, uuid(1)]))[0];
  assert.match(ev.reason, /^Win: \+/);
  assert.equal((await q(`select gold_earned from public.profiles where id = $1`, [uuid(1)]))[0].gold_earned, 35); // 20 first casual game + 15 ranked
});

await test('repeat opponents earn a smaller gain, and 5 ranked games in a week raise a flag', async () => {
  const gains: number[] = [];
  let prev = (await ranked(5, 1))?.mu ?? 25;
  for (let i = 0; i < 5; i++) {
    await finalGame('ranked', 1, [5], [6], 11, 3);
    const cur = (await ranked(5, 1)).mu;
    gains.push(cur - prev);
    prev = cur;
  }
  assert.ok(gains[4]! < gains[0]!, `gain should shrink: ${gains.join(', ')}`);
  const flags = await q(`select user_id from public.integrity_flags where kind = 'repeat_pairing'`);
  assert.equal(flags.length, 2, 'both players flagged once');
});

await test('Gold daily cap holds (100/day)', async () => {
  for (let i = 0; i < 9; i++) {
    await finalGame('casual', 1, [8], [3], 11, 2);
  }
  assert.ok((await q('select gold_earned from public.profiles where id = $1', [uuid(8)]))[0].gold_earned <= 100);
});

const WED = '2026-10-14T12:00:00Z';
async function goldAt(user: number, lane: string, at: string, game: string) {
  return (await q('select public.award_game_gold($1, $2, $3, $4::timestamptz) g', [game, uuid(user), lane, at]))[0].g as number;
}
await test('weekly goal: +50 once, on the first game of the 3rd distinct play day, inside the daily cap', async () => {
  const game = (await q('select id from public.games limit 1'))[0].id;
  await mkUser(20);
  assert.equal(await goldAt(20, 'casual', '2026-10-12T12:00:00Z', game), 20); // Mon: 10 + 10 first game
  assert.equal(await goldAt(20, 'casual', '2026-10-12T13:00:00Z', game), 10); // second game same day: base only
  assert.equal(await goldAt(20, 'casual', '2026-10-13T12:00:00Z', game), 20); // Tue
  assert.equal(await goldAt(20, 'ranked', WED, game), 15 + 10 + 50); // Wed: 3rd day -> base + first-game + weekly
  assert.equal(await goldAt(20, 'casual', '2026-10-14T13:00:00Z', game), 10); // weekly goal is paid only once
  assert.equal(await goldAt(20, 'casual', '2026-10-15T12:00:00Z', game), 20); // Thu: 4th day, no second weekly
  assert.equal((await q(`select count(*)::int n from public.gold_ledger where user_id = $1 and reason = 'weekly_goal'`, [uuid(20)]))[0].n, 1);
  assert.equal(await goldAt(20, 'casual', '2026-10-19T12:00:00Z', game), 20); // next week starts clean: no goal on day 1
});
await test('the daily cap trims bonuses too, and spending never raises room under the cap', async () => {
  const game = (await q('select id from public.games limit 1'))[0].id;
  await mkUser(21);
  await q(`insert into public.gold_ledger (user_id, wallet, amount, reason, created_at) values ($1,'earned',95,'game','2026-10-20T08:00:00Z')`, [uuid(21)]);
  await q(`insert into public.gold_ledger (user_id, wallet, amount, reason, created_at) values ($1,'earned',-90,'purchase','2026-10-20T09:00:00Z')`, [uuid(21)]);
  assert.equal(await goldAt(21, 'ranked', '2026-10-20T12:00:00Z', game), 5); // 95 earned already, so only 5 left although the balance is 5
});

await test('cold start: a first game in a new tier starts from the other tiers instead of 1200', async () => {
  for (const u of [30, 31, 32, 33]) await mkUser(u);
  for (let i = 0; i < 12; i++) await finalGame('ranked', 1, [30], [31], 11, 3); // 30 becomes clearly better than default in tier 1
  const t1 = await ranked(30, 1);
  assert.ok(t1.mu > 25.5);
  await finalGame('ranked', 2, [30], [32], 11, 9);
  const ev = (await q(`select before_rating from public.rating_events where user_id = $1 and tier = 2 order by created_at desc limit 1`, [uuid(30)]))[0];
  assert.notEqual(ev.before_rating, 1200, 'started from the tier 1 rating, not from 1200');
  const expected = Math.floor(1200 + (t1.mu - 25) * 24 + 0.5);
  assert.equal(ev.before_rating, expected);
  const a = await ranked(32, 2); // a brand-new player still starts at the default
  assert.ok(Math.abs(a.mu - 25) < 5);
});

await test('a non-final game is not rated', async () => {
  const id = `30000000-0000-0000-0000-${String(++gameSeq).padStart(12, '0')}`;
  await q(`insert into public.games (id, court_id, lane, tier, preset_id, mode, state, created_by) values ($1,$2,'ranked',1,'11-1s-w2','quick','{}',$3)`, [id, COURT, uuid(1)]);
  await q(`insert into public.rating_jobs (game_id) values ($1)`, [id]);
  const before = (await q('select count(*)::int n from public.rating_events'))[0].n;
  await q('select public.retry_rating_jobs()');
  assert.equal((await q('select count(*)::int n from public.rating_events'))[0].n, before);
  assert.match((await q('select error from public.rating_jobs where game_id = $1', [id]))[0].error, /not final/);
});

await test('a game without everyone\'s consent is never rated, even if a job exists', async () => {
  const id = `30000000-0000-0000-0000-${String(++gameSeq).padStart(12, '0')}`;
  await q(`insert into public.games (id, court_id, lane, tier, preset_id, mode, status, state, created_by) values ($1,$2,'ranked',1,'11-1s-w2','quick','final','{}',$3)`, [id, COURT, uuid(1)]);
  await q(`insert into public.game_players (game_id, user_id, side, accepted_at) values ($1,$2,'A',now()), ($1,$3,'B',null)`, [id, uuid(1), uuid(2)]);
  await q(`update public.games set score_a = 11, score_b = 3 where id = $1`, [id]);
  await q('insert into public.rating_jobs (game_id) values ($1)', [id]);
  const before = (await q('select count(*)::int n from public.rating_events'))[0].n;
  await q('select public.retry_rating_jobs()');
  assert.equal((await q('select count(*)::int n from public.rating_events'))[0].n, before);
  assert.match((await q('select error from public.rating_jobs where game_id = $1', [id]))[0].error, /consent/);
});

await test('a rating failure never blocks finalizing a game, leaves no partial writes, and a retry fixes it', async () => {
  await q('alter table public.ratings add constraint zz_break check (mu < 0) not valid'); // applies to new rows only; forces process_game_result to fail
  let id = '';
  try {
    id = await finalGame('ranked', 1, [5], [6], 11, 1);
  } finally {
    await q('alter table public.ratings drop constraint zz_break');
  }
  assert.equal((await q('select status from public.games where id = $1', [id]))[0].status, 'final'); // the game still finalized
  const job = (await q('select processed_at, error from public.rating_jobs where game_id = $1', [id]))[0];
  assert.equal(job.processed_at, null);
  assert.match(job.error, /zz_break|check constraint/);
  assert.equal((await q('select count(*)::int n from public.gold_ledger where game_id = $1', [id]))[0].n, 0); // sub-transaction rolled back
  assert.equal((await q('select count(*)::int n from public.rating_events where game_id = $1', [id]))[0].n, 0);
  assert.equal((await q('select public.retry_rating_jobs() n'))[0].n, 1);
  assert.equal((await q('select count(*)::int n from public.rating_events where game_id = $1', [id]))[0].n, 2);
});

await test('clients cannot call the rating functions', async () => {
  for (const fn of ['process_game_result(uuid)', 'retry_rating_jobs()']) {
    const r = await q(`select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') a, has_function_privilege('anon', 'public.${fn}', 'EXECUTE') b`);
    assert.deepEqual(r[0], { a: false, b: false }, fn);
  }
});

await pool.end();
console.log(failed ? `${failed} FAILED` : 'all rating pipeline tests passed');
process.exit(failed ? 1 : 0);
