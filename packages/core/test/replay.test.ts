import { describe, expect, it } from 'vitest';
import { applyEvent, buildReplay, newGame, type GameEvent, type GameState, type Side } from '../src/index.js';

const play = (s: GameState, evs: GameEvent[]) => evs.reduce((st, e) => applyEvent(st, e), s);
const basket = (side: Side, points = 1): GameEvent[] => [
  { type: 'claim_point', side, points },
  { type: 'confirm_point', side: side === 'A' ? 'B' : 'A' },
];

describe('buildReplay', () => {
  it('a live game becomes one step per confirmed basket with the running score', () => {
    const s = play(newGame('7-1s-w1', 'live'), [...basket('A'), ...basket('B'), ...basket('A'), ...basket('A')]);
    const r = buildReplay(s);
    expect(r.mode).toBe('live');
    expect(r.steps.map((x) => [x.side, x.points, x.scoreA, x.scoreB])).toEqual([['A', 1, 1, 0], ['B', 1, 1, 1], ['A', 1, 2, 1], ['A', 1, 3, 1]]);
    expect(r.finalScore).toEqual({ A: 3, B: 1 });
    expect(r.durationMs).toBeGreaterThan(0);
    expect(r.steps.every((x, i) => i === 0 || x.t > r.steps[i - 1]!.t)).toBe(true);
    expect(r.steps.map((x) => x.durationMs)).toEqual([7000, 7000, 7000, 7000]);
    expect(r.durationMs).toBe(4 * 7000 + 2500);
  });

  it('1 point is a dunk, 2 points is a three; who scored is carried only when told', () => {
    const s = play(newGame('11-1s2s-w1', 'live'), [
      { type: 'claim_point', side: 'A', points: 1, scorer: 'p-ana' }, { type: 'confirm_point', side: 'B' },
      ...basket('B', 2),
    ]);
    const r = buildReplay(s);
    expect(r.steps.map((x) => [x.shot, x.scorer])).toEqual([['dunk', 'p-ana'], ['three', undefined]]);
  });

  it('twos are carried through', () => {
    const r = buildReplay(play(newGame('11-1s2s-w1', 'live'), basket('B', 2)));
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ side: 'B', points: 2, scoreA: 0, scoreB: 2 });
  });

  it('a game with no baskets has an empty timeline and says so (does not crash)', () => {
    const r = buildReplay(newGame('7-1s-w1', 'live'));
    expect(r.steps).toEqual([]);
    expect(r.available).toBe(false);
    expect(r.note).toMatch(/no baskets/i);
  });

  it('a single basket works', () => {
    const r = buildReplay(play(newGame('7-1s-w1', 'live'), basket('A')));
    expect(r.steps).toHaveLength(1);
    expect(r.available).toBe(true);
  });

  it('an unconfirmed claim is not shown', () => {
    const r = buildReplay(play(newGame('7-1s-w1', 'live'), [...basket('A'), { type: 'claim_point', side: 'B', points: 1 }]));
    expect(r.steps).toHaveLength(1);
    expect(r.finalScore).toEqual({ A: 1, B: 0 });
  });

  it('a quick game only knows the final score, and says so instead of inventing an order', () => {
    let s = newGame('7-1s-w1', 'quick');
    s = play(s, [{ type: 'propose_final', side: 'A', score: { A: 7, B: 2 } }, { type: 'confirm_proposed', side: 'B' }]);
    const r = buildReplay(s);
    expect(r.mode).toBe('quick');
    expect(r.steps).toEqual([]);
    expect(r.available).toBe(false);
    expect(r.note).toMatch(/final score/i);
    expect(r.finalScore).toEqual({ A: 7, B: 2 });
    expect(r.winner).toBe('A');
  });

  it('a score fixed after a dispute ends on the resolved score (adjust step), never on a stale one', () => {
    let s = play(newGame('7-1s-w1', 'live'), [...basket('A'), ...basket('A'), { type: 'claim_point', side: 'B', points: 1 }, { type: 'dispute', side: 'A', reason: 'no' }]);
    s = play(s, [{ type: 'resolve_dispute', side: 'A', score: { A: 2, B: 1 } }, { type: 'resolve_dispute', side: 'B', score: { A: 2, B: 1 } }]);
    const r = buildReplay(s);
    expect(r.finalScore).toEqual({ A: 2, B: 1 });
    const last = r.steps[r.steps.length - 1]!;
    expect([last.scoreA, last.scoreB]).toEqual([2, 1]);
  });

  it('a voided game has no replay', () => {
    const s = play(newGame('7-1s-w1', 'live'), [{ type: 'void', side: 'A' }]);
    const r = buildReplay(s);
    expect(r.available).toBe(false);
    expect(r.note).toMatch(/voided/i);
  });

  it('keeps long games watchable: about 7 s a shot, never more than 90 s in total', () => {
    let s = newGame('21-1s-w1', 'live');
    for (let i = 0; i < 20; i++) s = play(s, basket(i % 2 ? 'A' : 'B'));
    const r = buildReplay(s);
    expect(r.durationMs).toBeLessThanOrEqual(90_000);
    expect(r.steps.every((x) => x.durationMs >= 4000 || x.kind === 'adjust')).toBe(true);
  });

  it('property: over 300 random games the replay always ends on the game\'s own score and never goes backwards', () => {
    let seed = 7;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let g = 0; g < 300; g++) {
      let s = newGame(['7-1s-w1', '11-1s2s-w2', '21-1s2s-w1'][Math.floor(rnd() * 3)]!, 'live');
      for (let i = 0; i < 80 && s.status === 'active'; i++) {
        const side: Side = rnd() < 0.5 ? 'A' : 'B';
        const other: Side = side === 'A' ? 'B' : 'A';
        const evs: GameEvent[] = rnd() < 0.08
          ? [{ type: 'claim_point', side, points: 1 }, { type: 'dispute', side: other, reason: 'x' }, { type: 'resolve_dispute', side: 'A', score: { A: s.score.A, B: s.score.B } }, { type: 'resolve_dispute', side: 'B', score: { A: s.score.A, B: s.score.B } }]
          : [{ type: 'claim_point', side, points: rnd() < 0.5 ? 1 : 2 }, { type: 'confirm_point', side: other }];
        for (const e of evs) {
          try {
            s = applyEvent(s, e);
          } catch {
            /* illegal for this preset or state: the server would refuse it too */
          }
        }
      }
      const r = buildReplay(s);
      expect(r.finalScore).toEqual(s.score);
      let pa = 0;
      let pb = 0;
      for (const st of r.steps) {
        expect(st.scoreA).toBeGreaterThanOrEqual(pa);
        expect(st.scoreB).toBeGreaterThanOrEqual(pb);
        pa = st.scoreA;
        pb = st.scoreB;
      }
      if (r.steps.length) expect([pa, pb]).toEqual([s.score.A, s.score.B]);
      expect(r.durationMs).toBeLessThanOrEqual(Math.max(90_000, r.steps.length * 4000 + 2500 + 1500)); // 4 s a shot is the floor
    }
  });
});
