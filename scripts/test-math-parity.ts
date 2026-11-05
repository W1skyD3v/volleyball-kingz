/**
 * Fuzz parity: the in-database rating math (migration 9) must equal packages/core/src/rating.ts on random inputs:
 * Plackett-Luce for 1v1..5v5, display scale, repeat weights, and Elo (including the reason strings).
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { displayRating, eloUpdate, priorFor, rateRaw, repeatWeight, type SkillRating } from '@vk/core';

const client = new pg.Client({ database: process.env.PGDATABASE ?? 'vk_test' });
await client.connect();
let seed = 20261017;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const between = (a: number, b: number) => a + rnd() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));

let plChecks = 0, otherChecks = 0, maxErr = 0;
for (let t = 0; t < 1500; t++) {
  const size = int(1, 5);
  const mk = (): SkillRating => ({ mu: between(8, 42), sigma: between(0.8, 25 / 3) });
  const A = Array.from({ length: size }, mk);
  const B = Array.from({ length: size }, mk);
  const win = rnd() < 0.5 ? 'A' : 'B';
  const ts = rateRaw(A, B, win);
  const all = [...A, ...B];
  const sides = [...A.map(() => 'A'), ...B.map(() => 'B')];
  const { rows } = await client.query('select idx, new_mu, new_sigma from public.vk_rate_two_teams($1::float8[], $2::float8[], $3::text[], $4) order by idx', [all.map((p) => p.mu), all.map((p) => p.sigma), sides, win]);
  const expected = [...ts.A, ...ts.B];
  assert.equal(rows.length, expected.length);
  expected.forEach((e, i) => {
    const dm = Math.abs(rows[i].new_mu - e.mu), ds = Math.abs(rows[i].new_sigma - e.sigma);
    maxErr = Math.max(maxErr, dm, ds);
    assert.ok(dm < 1e-9 && ds < 1e-9, `PL mismatch (size ${size}, win ${win}, player ${i}): sql ${rows[i].new_mu}/${rows[i].new_sigma} vs ts ${e.mu}/${e.sigma}`);
  });
  plChecks += expected.length;

  const mu = between(-5, 60);
  assert.equal((await client.query('select public.vk_display_rating($1::float8) v', [mu])).rows[0].v, displayRating({ mu, sigma: 1 }).rating, `display ${mu}`);

  const no = int(0, 8), nm = int(0, 8);
  assert.equal((await client.query('select public.vk_repeat_weight($1, $2) v', [no, nm])).rows[0].v, repeatWeight(no, nm), `repeat ${no},${nm}`);

  const rating = Math.round(between(700, 1900) * 10) / 10, games = int(0, 30), ownAvg = between(900, 1700), oppAvg = between(900, 1700), won = rnd() < 0.5;
  const w = [1, repeatWeight(int(0, 5), int(0, 5)), 0][int(0, 2)]!;
  const sql = (await client.query('select * from public.vk_elo_update($1::float8, $2::int, $3::float8, $4::float8, $5::bool, $6::float8)', [rating, games, ownAvg, oppAvg, won, w])).rows[0];
  const js = eloUpdate({ rating, games }, ownAvg, oppAvg, won, w);
  assert.equal(sql.new_rating, js.rating, `elo rating ${JSON.stringify({ rating, games, ownAvg, oppAvg, won, w })}`);
  assert.equal(sql.delta + 0, js.delta + 0, 'elo delta'); // + 0 normalizes JavaScript's -0
  assert.equal(sql.reason, js.reason, 'elo reason');
  otherChecks += 4;

  // cold-start prior: random existing tier ratings (some with 0 games)
  const existing = Array.from({ length: int(0, 4) }, () => ({ mu: between(8, 42), sigma: between(0.8, 25 / 3), games: [0, int(1, 12), int(10, 60)][int(0, 2)]! }));
  const pr = (await client.query('select * from public.vk_prior_from($1::float8[], $2::float8[], $3::int[])', [existing.map((e) => e.mu), existing.map((e) => e.sigma), existing.map((e) => e.games)])).rows[0];
  const pj = priorFor(existing);
  assert.ok(Math.abs(pr.mu - pj.mu) < 1e-9 && Math.abs(pr.sigma - pj.sigma) < 1e-9, `prior mismatch ${JSON.stringify(existing)}: sql ${pr.mu}/${pr.sigma} vs ts ${pj.mu}/${pj.sigma}`);
  otherChecks += 2;
}
console.log(`math parity ok: ${plChecks} Plackett-Luce player updates (1v1..5v5, max abs error ${maxErr.toExponential(1)}), ${otherChecks} display/repeat/Elo checks`);
await client.end();
