import { describe, expect, it } from 'vitest';
import {
  PICKUP_PRESET_ID, ScoringError, applyEvent, currentServer, newGame, ratingWeight, rotate, setWins, winnerOf,
  type GameEvent, type GameState, type Side,
} from '../src/index.js';

const roster = (n: number) => ({ A: Array.from({ length: n }, (_, i) => `a${i + 1}`), B: Array.from({ length: n }, (_, i) => `b${i + 1}`) });
const T0 = 1_000_000;
const game = (preset: string, tier = 2, mode: 'live' | 'quick' = 'live') => newGame(preset, mode, { roster: roster(tier), startedAt: T0 });
const ap = (s: GameState, ev: GameEvent) => applyEvent(s, { ...ev, at: ev.at ?? T0 + 1000 } as GameEvent);
const other = (x: Side): Side => (x === 'A' ? 'B' : 'A');
/** One confirmed rally for `side`. */
const point = (s: GameState, side: Side, extra: { tag?: string; who?: string; at?: number } = {}): GameState =>
  ap(ap(s, { type: 'claim_point', side, ...extra }), { type: 'confirm_point', side: other(side), ...(extra.at !== undefined ? { at: extra.at } : {}) });
const points = (s: GameState, side: Side, n: number) => { let x = s; for (let i = 0; i < n; i++) x = point(x, side); return x; };
const throwsMsg = (f: () => unknown, msg?: string) => expect(f).toThrow(msg ? new RegExp(msg) : ScoringError);

describe('live scoring: one set', () => {
  it('rally scoring: every confirmed rally is one point for its winner', () => {
    let s = game('11-w2-bo1');
    s = point(s, 'A');
    s = point(s, 'B');
    s = point(s, 'B');
    expect(s.score).toEqual({ A: 1, B: 2 });
    expect(s.points.map((p) => p.side)).toEqual(['A', 'B', 'B']);
  });
  it('the claiming side cannot confirm its own point; only one claim at a time', () => {
    let s = ap(game('11-w2-bo1'), { type: 'claim_point', side: 'A' });
    throwsMsg(() => ap(s, { type: 'confirm_point', side: 'A' }));
    throwsMsg(() => ap(s, { type: 'claim_point', side: 'B' }));
    s = ap(s, { type: 'confirm_point', side: 'B' });
    expect(s.pending).toBeNull();
  });
  it('a set to 11 win by 2: 11-9 ends it, 11-10 does not', () => {
    let s = game('11-w2-bo1');
    for (let i = 0; i < 10; i++) { s = point(s, 'A'); s = point(s, 'B'); }
    s = point(s, 'A');
    expect(s.status).toBe('active'); // 11-10
    s = point(s, 'B'); // 11-11
    s = point(s, 'A'); // 12-11
    expect(s.status).toBe('active');
    s = point(s, 'A'); // 13-11
    expect(s.status).toBe('awaiting_final');
    expect(s.sets).toEqual([{ A: 13, B: 11 }]);
  });
  it('both captains confirm the end; the winner and rating weight follow', () => {
    let s = points(game('11-w2-bo1'), 'B', 11);
    expect(s.status).toBe('awaiting_final');
    expect(winnerOf(s)).toBeNull();
    s = ap(s, { type: 'confirm_final', side: 'A' });
    expect(s.status).toBe('awaiting_final');
    s = ap(s, { type: 'confirm_final', side: 'B' });
    expect(s.status).toBe('final');
    expect(winnerOf(s)).toBe('B');
    expect(ratingWeight(s)).toBe(1);
    expect(setWins(s.sets)).toEqual({ A: 0, B: 1 });
  });
  it('nothing can be scored in a lobby until start', () => {
    const lobby = newGame('11-w2-bo1', 'live', { lobby: true, roster: roster(2) });
    throwsMsg(() => ap(lobby, { type: 'claim_point', side: 'A' }));
    const s = applyEvent(lobby, { type: 'start', at: T0 });
    expect(s.status).toBe('active');
    expect(s.startedAt).toBe(T0);
    throwsMsg(() => ap(s, { type: 'start' }));
  });
});

describe('serving and side-outs (every format)', () => {
  it('serve stays with a team that keeps winning and changes on a side-out', () => {
    let s = game('11-w2-bo1', 4);
    expect(s.serving).toBe('A');
    s = point(s, 'A');
    expect(s.points[0]).toMatchObject({ sideOut: false });
    expect(s.serving).toBe('A');
    s = point(s, 'B');
    expect(s.points[1]).toMatchObject({ sideOut: true });
    expect(s.serving).toBe('B');
    expect(s.events.filter((e) => e.k === 'side_out')).toHaveLength(1);
  });
  it('2v2 and 4v4 do not track a rotation or a named server', () => {
    for (const tier of [2, 4]) {
      let s = game('11-w2-bo1', tier);
      s = point(point(point(s, 'A'), 'B'), 'A');
      expect(s.rotation).toEqual(s.startOrder);
      expect(s.points.every((p) => p.server === undefined)).toBe(true);
    }
  });
});

describe('6v6 rotation', () => {
  it('rotate moves the next player in line to the server spot', () => {
    expect(rotate(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'])).toEqual(['p2', 'p3', 'p4', 'p5', 'p6', 'p1']);
    expect(rotate([])).toEqual([]);
  });
  it('only the receiving side rotates, and only on a side-out; the server is always rotation[serving][0]', () => {
    let s = game('25-w2-bo5', 6);
    expect(currentServer(s)).toBe('a1');
    s = point(s, 'A'); // serving team wins: no rotation
    expect(s.rotation.A).toEqual(s.startOrder.A);
    expect(s.points[0]).toMatchObject({ server: 'a1', sideOut: false });
    s = point(s, 'B'); // side-out: B rotates
    expect(s.rotation.B).toEqual(['b2', 'b3', 'b4', 'b5', 'b6', 'b1']);
    expect(s.rotation.A).toEqual(s.startOrder.A);
    expect(s.serving).toBe('B');
    expect(currentServer(s)).toBe('b2');
    expect(s.points[1]).toMatchObject({ server: 'a1', sideOut: true });
    s = point(s, 'A'); // side-out: A rotates
    expect(s.rotation.A).toEqual(['a2', 'a3', 'a4', 'a5', 'a6', 'a1']);
    expect(currentServer(s)).toBe('a2');
  });
  it('after six side-outs a team is back in its starting order', () => {
    let s = game('25-w2-bo5', 6);
    for (let i = 0; i < 6; i++) { s = point(s, 'B'); s = point(s, 'A'); }
    expect(s.rotation.A).toEqual(s.startOrder.A);
    expect(s.rotation.B).toEqual(s.startOrder.B);
  });
  it('a new set resets both rotations to the starting order', () => {
    let s = game('25-w2-bo5', 6);
    s = point(point(s, 'B'), 'A'); // both rotate once
    s = points(s, 'A', 24); // 25-1
    expect(s.sets.length).toBe(1);
    expect(s.setNo).toBe(2);
    expect(s.rotation).toEqual(s.startOrder);
  });
  it('substitution needs a bench: a full-roster game rejects it with no_bench; a bench player can come on', () => {
    const s = game('25-w2-bo5', 6);
    throwsMsg(() => ap(s, { type: 'substitution', side: 'A', out: 'a1', in: 'a9' }), 'no_bench');
    const withBench: GameState = { ...s, roster: { ...s.roster, A: [...s.roster.A, 'a7'] } };
    const sub = ap(withBench, { type: 'substitution', side: 'A', out: 'a3', in: 'a7' });
    expect(sub.rotation.A).toEqual(['a1', 'a2', 'a7', 'a4', 'a5', 'a6']);
    expect(sub.events.at(-1)).toMatchObject({ k: 'substitution', out: 'a3', in: 'a7' });
    throwsMsg(() => ap(withBench, { type: 'substitution', side: 'A', out: 'a3', in: 'a2' })); // a2 is on court
    throwsMsg(() => ap(game('21-w2-bo3', 2), { type: 'substitution', side: 'A', out: 'a1', in: 'a3' }), 'indoor');
  });
});

describe('matches: sets, deciding set, side switches', () => {
  it('beach best of 3: set 1 to 21, then a second set, then a deciding set to 15', () => {
    let s = game('21-w2-bo3');
    s = points(s, 'A', 21);
    expect(s.sets).toEqual([{ A: 21, B: 0 }]);
    expect(s.status).toBe('active');
    expect(s.setNo).toBe(2);
    expect(s.score).toEqual({ A: 0, B: 0 });
    s = points(s, 'B', 21);
    expect(s.sets).toHaveLength(2);
    expect(s.setNo).toBe(3);
    s = points(s, 'A', 14);
    expect(s.status).toBe('active');
    s = point(s, 'A'); // 15-0 in the deciding set
    expect(s.status).toBe('awaiting_final');
    expect(s.sets[2]).toEqual({ A: 15, B: 0 });
    expect(setWins(s.sets)).toEqual({ A: 2, B: 1 });
    expect(s.events.filter((e) => e.k === 'set_end')).toHaveLength(3);
  });
  it('a 2-0 win ends the match without a third set', () => {
    const s = points(points(game('21-w2-bo3'), 'A', 21), 'A', 21);
    expect(s.status).toBe('awaiting_final');
    expect(s.sets).toHaveLength(2);
  });
  it('first serve alternates every set and teams change ends between sets', () => {
    let s = game('21-w2-bo3', 4);
    expect(s.serving).toBe('A');
    expect(s.ends).toEqual({ A: 'L', B: 'R' });
    s = points(s, 'A', 21);
    expect(s.serving).toBe('B');
    expect(s.ends).toEqual({ A: 'R', B: 'L' });
    s = points(s, 'B', 21);
    expect(s.serving).toBe('A');
    expect(s.ends).toEqual({ A: 'L', B: 'R' });
  });
  it('beach 2v2 switches ends every 7 points in a normal set and every 5 in the deciding set', () => {
    let s = game('21-w2-bo3', 2);
    const totals: number[] = [];
    for (let i = 1; i <= 14; i++) {
      s = point(s, i % 2 ? 'A' : 'B');
      if (s.events.filter((e) => e.k === 'side_switch').length > totals.length) totals.push(i);
    }
    expect(totals).toEqual([7, 14]);
    expect(s.ends).toEqual({ A: 'L', B: 'R' }); // two switches = back where they started
    // finish the set, play set 2, reach the decider
    s = points(s, 'A', 21 - 7);
    s = points(s, 'B', 21);
    expect(s.setNo).toBe(3);
    const before = s.events.filter((e) => e.k === 'side_switch').length;
    for (let i = 1; i <= 10; i++) s = point(s, i % 2 ? 'A' : 'B');
    const sw = s.events.filter((e): e is Extract<typeof e, { k: 'side_switch' }> => e.k === 'side_switch').slice(before);
    expect(sw.map((e) => e.total)).toEqual([5, 10]);
    expect(sw.every((e) => e.set === 3)).toBe(true);
  });
  it('a set-ending point is a set end, not a side switch; indoor and 4v4 never switch mid-set', () => {
    let s = game('11-w2-bo1', 2);
    for (let i = 0; i < 7; i++) s = point(s, 'A');
    for (let i = 0; i < 4; i++) s = point(s, 'A'); // 11-0 ends the set
    expect(s.events.filter((e) => e.k === 'side_switch')).toHaveLength(1);
    for (const tier of [4, 6]) {
      let g = game('25-w2-bo5', tier);
      g = points(g, 'A', 14);
      expect(g.events.filter((e) => e.k === 'side_switch')).toHaveLength(0);
    }
  });
  it('indoor best of 5 needs three set wins', () => {
    let s = game('25-w2-bo5', 6);
    s = points(s, 'A', 25); s = points(s, 'B', 25); s = points(s, 'A', 25); s = points(s, 'B', 25);
    expect(s.status).toBe('active');
    expect(s.setNo).toBe(5);
    s = points(s, 'B', 14);
    expect(s.status).toBe('active');
    s = point(s, 'B');
    expect(s.status).toBe('awaiting_final');
    expect(setWins(s.sets)).toEqual({ A: 2, B: 3 });
  });
});

describe('per-point tags and who', () => {
  it('accepts ace/kill/block/error, rejects anything else', () => {
    for (const tag of ['ace', 'kill', 'block', 'error']) {
      expect(() => ap(game('11-w2-bo1', 4), { type: 'claim_point', side: 'A', tag })).not.toThrow();
    }
    throwsMsg(() => ap(game('11-w2-bo1'), { type: 'claim_point', side: 'A', tag: 'dink' }), 'tag');
  });
  it('an ace needs the point winner to be serving', () => {
    const s = game('11-w2-bo1', 4);
    expect(() => ap(s, { type: 'claim_point', side: 'A', tag: 'ace' })).not.toThrow();
    throwsMsg(() => ap(s, { type: 'claim_point', side: 'B', tag: 'ace' }), 'ace');
  });
  it('who must be on the winning side, except for an error which belongs to the losing side', () => {
    const s = game('11-w2-bo1', 4);
    expect(() => ap(s, { type: 'claim_point', side: 'A', tag: 'kill', who: 'a2' })).not.toThrow();
    throwsMsg(() => ap(s, { type: 'claim_point', side: 'A', tag: 'kill', who: 'b2' }), 'right side');
    throwsMsg(() => ap(s, { type: 'claim_point', side: 'A', who: 'zz' }), 'right side');
    expect(() => ap(s, { type: 'claim_point', side: 'A', tag: 'error', who: 'b1' })).not.toThrow();
    throwsMsg(() => ap(s, { type: 'claim_point', side: 'A', tag: 'error', who: 'a1' }), 'right side');
  });
  it('the confirmed rally keeps the tag and who', () => {
    const s = point(game('11-w2-bo1', 4), 'A', { tag: 'ace', who: 'a1' });
    expect(s.points[0]).toMatchObject({ side: 'A', tag: 'ace', who: 'a1', sideOut: false });
    expect(point(game('11-w2-bo1', 4), 'A').points[0]).not.toHaveProperty('tag');
  });
});

describe('timeouts', () => {
  it('two per team per set, live only, not while a point is pending; they reset each set', () => {
    let s = game('11-w2-bo3');
    s = ap(ap(s, { type: 'timeout', side: 'A' }), { type: 'timeout', side: 'A' });
    throwsMsg(() => ap(s, { type: 'timeout', side: 'A' }), 'timeouts');
    s = ap(s, { type: 'timeout', side: 'B' });
    throwsMsg(() => ap(ap(s, { type: 'claim_point', side: 'A' }), { type: 'timeout', side: 'B' }));
    s = points(s, 'A', 11);
    expect(s.timeouts).toEqual({ A: 0, B: 0 });
    throwsMsg(() => ap(game('11-w2-bo1', 2, 'quick'), { type: 'timeout', side: 'A' }));
  });
});

describe('quick mode: confirm the final set scores at the end', () => {
  const q = (preset: string, tier = 2) => game(preset, tier, 'quick');
  it('proposal needs the other side to confirm; claims are live-only', () => {
    let s = q('15-w2-bo1');
    throwsMsg(() => ap(s, { type: 'claim_point', side: 'A' }));
    s = ap(s, { type: 'propose_final', side: 'A', sets: [{ A: 15, B: 11 }] });
    throwsMsg(() => ap(s, { type: 'confirm_proposed', side: 'A' }));
    s = ap(s, { type: 'confirm_proposed', side: 'B' });
    expect(s.status).toBe('final');
    expect(s.sets).toEqual([{ A: 15, B: 11 }]);
    expect(winnerOf(s)).toBe('A');
  });
  it('rejects unreachable, unfinished and over-long results', () => {
    const p = (s: GameState, sets: { A: number; B: number }[]) => () => ap(s, { type: 'propose_final', side: 'A', sets });
    const s1 = q('15-w2-bo1');
    expect(p(s1, [{ A: 14, B: 12 }])).toThrow(); // not finished
    expect(p(s1, [{ A: 15, B: 14 }])).toThrow(); // not win by 2
    expect(p(s1, [{ A: 18, B: 14 }])).toThrow(); // unreachable
    expect(p(s1, [])).toThrow();
    expect(p(s1, [{ A: 15, B: 0 }, { A: 15, B: 0 }])).toThrow(); // set after a decided match
    expect(p(s1, [{ A: 100, B: 98 }])).toThrow();
    const s3 = q('21-w2-bo3');
    expect(p(s3, [{ A: 21, B: 10 }])).toThrow(); // best of 3 needs two set wins
    expect(p(s3, [{ A: 21, B: 10 }, { A: 10, B: 21 }])).toThrow(); // 1-1: the deciding set is missing
    expect(p(s3, [{ A: 21, B: 10 }, { A: 10, B: 21 }, { A: 21, B: 5 }])).toThrow(); // unreachable in a set to 15
    expect(p(s3, [{ A: 21, B: 10 }, { A: 10, B: 21 }, { A: 15, B: 13 }])).not.toThrow();
    expect(p(s3, [{ A: 21, B: 19 }, { A: 22, B: 20 }])).not.toThrow();
  });
  it('a dispute freezes a pending Quick proposal (cannot be confirmed while disputed)', () => {
    let s = ap(q('11-w2-bo1'), { type: 'propose_final', side: 'A', sets: [{ A: 11, B: 5 }] });
    s = ap(s, { type: 'dispute', side: 'B', reason: 'no' });
    expect(s.status).toBe('disputed');
    throwsMsg(() => ap(s, { type: 'confirm_proposed', side: 'B' }));
  });
});

describe('disputes', () => {
  it('freeze scoring; resume only when both captains submit the same set list', () => {
    let s = point(game('11-w2-bo1'), 'A');
    s = ap(s, { type: 'dispute', side: 'B', reason: 'we had it' });
    expect(s.status).toBe('disputed');
    throwsMsg(() => ap(s, { type: 'claim_point', side: 'A' }));
    s = ap(s, { type: 'resolve_dispute', side: 'A', sets: [{ A: 3, B: 2 }] });
    s = ap(s, { type: 'resolve_dispute', side: 'B', sets: [{ A: 2, B: 2 }] });
    expect(s.status).toBe('disputed');
    s = ap(s, { type: 'resolve_dispute', side: 'B', sets: [{ A: 3, B: 2 }] });
    expect(s.status).toBe('active');
    expect(s.score).toEqual({ A: 3, B: 2 });
    expect(s.corrected).toBe(true);
    expect(s.dispute).toBeNull();
  });
  it('an agreed result that decides the match goes to the end-of-match confirmation', () => {
    let s = ap(point(game('21-w2-bo3'), 'A'), { type: 'dispute', side: 'A', reason: 'x' });
    const sets = [{ A: 21, B: 15 }, { A: 21, B: 18 }];
    s = ap(ap(s, { type: 'resolve_dispute', side: 'A', sets }), { type: 'resolve_dispute', side: 'B', sets });
    expect(s.status).toBe('awaiting_final');
    expect(s.sets).toEqual(sets);
  });
  it('an agreed score between sets starts the next set', () => {
    let s = ap(point(game('21-w2-bo3'), 'A'), { type: 'dispute', side: 'A', reason: 'x' });
    const sets = [{ A: 21, B: 15 }, { A: 4, B: 3 }];
    s = ap(ap(s, { type: 'resolve_dispute', side: 'A', sets }), { type: 'resolve_dispute', side: 'B', sets });
    expect(s.status).toBe('active');
    expect(s.sets).toEqual([{ A: 21, B: 15 }]);
    expect(s.setNo).toBe(2);
    expect(s.score).toEqual({ A: 4, B: 3 });
  });
  it('nonsense resolutions are refused at submission', () => {
    const s = ap(point(game('21-w2-bo3'), 'A'), { type: 'dispute', side: 'A', reason: 'x' });
    throwsMsg(() => ap(s, { type: 'resolve_dispute', side: 'A', sets: [{ A: 21, B: 20 }, { A: 3, B: 3 }] })); // an unfinished set that is not the last
    throwsMsg(() => ap(s, { type: 'resolve_dispute', side: 'A', sets: [{ A: -1, B: 0 }] }));
  });
  it('can dispute at the end of a match too', () => {
    const s = ap(points(game('11-w2-bo1'), 'A', 11), { type: 'dispute', side: 'B', reason: 'x' });
    expect(s.status).toBe('disputed');
    expect(s.dispute?.from).toBe('awaiting_final');
  });
});

describe('void', () => {
  it('is free at 0-0 and in the lobby; needs both captains once play started; closed games reject everything', () => {
    expect(applyEvent(game('11-w2-bo1'), { type: 'void', side: 'A' }).status).toBe('voided');
    expect(applyEvent(newGame('11-w2-bo1', 'live', { lobby: true, roster: roster(2) }), { type: 'void', side: 'B' }).status).toBe('voided');
    let s = point(game('11-w2-bo1'), 'A');
    s = ap(s, { type: 'void', side: 'B' });
    expect(s.status).toBe('active');
    expect(s.voidRequest).toEqual({ by: 'B' });
    s = ap(s, { type: 'void', side: 'B' });
    expect(s.status).toBe('active'); // same side again does not count
    s = ap(s, { type: 'void', side: 'A' });
    expect(s.status).toBe('voided');
    throwsMsg(() => ap(s, { type: 'claim_point', side: 'A' }));
    expect(ratingWeight(s)).toBe(0);
  });
});

describe('time cap (pickup: 15, win by 2, 20 minutes, server time)', () => {
  const MIN = 60_000;
  const g = () => game(PICKUP_PRESET_ID, 2);
  const late = T0 + 20 * MIN + 5000;
  it('time_up is refused before the cap and for presets without one', () => {
    throwsMsg(() => ap(g(), { type: 'time_up', side: 'A', at: T0 + 19 * MIN }), 'not passed');
    throwsMsg(() => ap(game('15-w2-bo1'), { type: 'time_up', side: 'A', at: late }), 'no time cap');
  });
  it('at the cap the higher score wins', () => {
    let s = points(point(g(), 'B'), 'A', 5); // 5-1
    s = applyEvent(s, { type: 'time_up', side: 'B', at: late });
    expect(s.status).toBe('awaiting_final');
    expect(s.sets).toEqual([{ A: 5, B: 1 }]);
    expect(s.timeUp).toBe(true);
    expect(s.events.at(-1)).toMatchObject({ k: 'set_end', winner: 'A' });
    s = applyEvent(applyEvent(s, { type: 'confirm_final', side: 'A', at: late }), { type: 'confirm_final', side: 'B', at: late });
    expect(winnerOf(s)).toBe('A');
  });
  it('a tie at the cap plays to the next point: the next rally wins', () => {
    let s = point(point(g(), 'A'), 'B'); // 1-1
    s = applyEvent(s, { type: 'time_up', side: 'A', at: late });
    expect(s.status).toBe('active');
    expect(s.timeUp).toBe(true);
    s = applyEvent(applyEvent(s, { type: 'claim_point', side: 'B', at: late }), { type: 'confirm_point', side: 'A', at: late });
    expect(s.status).toBe('awaiting_final');
    expect(s.sets).toEqual([{ A: 1, B: 2 }]);
    expect(s.events.at(-1)).toMatchObject({ k: 'set_end', winner: 'B' });
  });
  it('after the cap nobody can add a point until time is called', () => {
    const s = point(g(), 'A');
    throwsMsg(() => applyEvent(s, { type: 'claim_point', side: 'A', at: late }), 'time_is_up');
    throwsMsg(() => applyEvent(applyEvent(s, { type: 'time_up', side: 'A', at: late }), { type: 'time_up', side: 'A', at: late }));
  });
  it('time_up waits for a pending point to be settled', () => {
    const s = ap(g(), { type: 'claim_point', side: 'A' });
    throwsMsg(() => applyEvent(s, { type: 'time_up', side: 'A', at: late }));
  });
  it('a normal finish before the cap is unaffected', () => {
    const s = points(g(), 'A', 15);
    expect(s.status).toBe('awaiting_final');
    expect(s.timeUp).toBe(false);
  });
  it('Quick mode: a leader-wins score is valid only after the cap has passed', () => {
    const q = newGame(PICKUP_PRESET_ID, 'quick', { roster: roster(2), startedAt: T0 });
    const propose = (at: number, A: number, B: number) => () => applyEvent(q, { type: 'propose_final', side: 'A', sets: [{ A, B }], at });
    expect(propose(T0 + 10 * MIN, 12, 9)).toThrow();
    expect(propose(late, 12, 9)).not.toThrow();
    expect(propose(late, 12, 12)).toThrow(); // a tie is never final
    expect(propose(late, 16, 15)).not.toThrow(); // tie at the cap, then the next point
    expect(propose(late, 15, 5)).not.toThrow(); // regular finish, still fine
    expect(propose(late, 25, 5)).toThrow(); // unreachable under any rule
  });
  it('a dispute resolution after the cap may settle on a leader score or leave a tie open', () => {
    let s = ap(point(g(), 'A'), { type: 'dispute', side: 'A', reason: 'x' });
    const a = (sets: { A: number; B: number }[]) => applyEvent(applyEvent(s, { type: 'resolve_dispute', side: 'A', sets, at: late }), { type: 'resolve_dispute', side: 'B', sets, at: late });
    expect(a([{ A: 9, B: 7 }]).status).toBe('awaiting_final');
    const tie = a([{ A: 8, B: 8 }]);
    expect(tie.status).toBe('active');
    expect(tie.timeUp).toBe(true);
    s = ap(point(g(), 'A'), { type: 'dispute', side: 'A', reason: 'x' });
    expect(a([{ A: 9, B: 7 }]).status).toBe('awaiting_final');
  });
});

describe('invariants under random play', () => {
  const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  it('rotation stays a permutation, score equals the rally list, and the server is rotation[serving][0]', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed);
      const tier = [2, 4, 6][Math.floor(r() * 3)]!;
      const preset = ['21-w2-bo3', '25-w2-bo5', '11-w2c-bo3', '15-w1-bo1'][Math.floor(r() * 4)]!;
      let s = game(preset, tier);
      for (let i = 0; i < 400 && s.status === 'active'; i++) {
        const side: Side = r() < 0.55 ? 'A' : 'B';
        s = point(s, side);
        for (const x of ['A', 'B'] as const) expect([...s.rotation[x]].sort()).toEqual([...s.startOrder[x]].sort());
        if (tier < 6) expect(s.rotation).toEqual(s.startOrder);
      }
      const total = s.sets.reduce((t, x) => t + x.A + x.B, 0) + (s.status === 'active' ? s.score.A + s.score.B : 0);
      expect(s.points.length).toBe(total);
      expect(['active', 'awaiting_final']).toContain(s.status);
    }
  });
});
