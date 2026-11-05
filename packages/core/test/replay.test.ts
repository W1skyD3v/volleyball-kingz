import { describe, expect, it } from 'vitest';
import { REPLAY_STEP_MS, applyEvent, buildReplay, newGame, stageFor, type GameEvent, type GameState, type Side } from '../src/index.js';

const roster = (n: number) => ({ A: Array.from({ length: n }, (_, i) => `a${i + 1}`), B: Array.from({ length: n }, (_, i) => `b${i + 1}`) });
const other = (x: Side): Side => (x === 'A' ? 'B' : 'A');
const ap = (s: GameState, e: GameEvent) => applyEvent(s, { ...e, at: 1_000 } as GameEvent);
const point = (s: GameState, side: Side, extra: { tag?: string; who?: string } = {}) =>
  ap(ap(s, { type: 'claim_point', side, ...extra }), { type: 'confirm_point', side: other(side) });
const fresh = (preset: string, tier = 2, mode: 'live' | 'quick' = 'live') => newGame(preset, mode, { roster: roster(tier), startedAt: 0 });

describe('replay', () => {
  it('one ~7 second step per rally, in order, with the running set score', () => {
    let s = fresh('11-w2-bo1');
    s = point(point(point(s, 'A'), 'B'), 'A');
    const r = buildReplay(s);
    expect(r.available).toBe(true);
    expect(r.steps).toHaveLength(3);
    expect(r.steps.map((x) => x.durationMs)).toEqual([REPLAY_STEP_MS, REPLAY_STEP_MS, REPLAY_STEP_MS]);
    expect(r.steps.map((x) => [x.scoreA, x.scoreB])).toEqual([[1, 0], [1, 1], [2, 1]]);
    expect(r.steps.map((x) => x.t)).toEqual([0, 7000, 14000]);
    expect(r.durationMs).toBeGreaterThan(21000);
  });
  it('maps tags to finishing scripts; untagged is the kill script', () => {
    let s = fresh('11-w2-bo1', 4);
    s = point(s, 'A', { tag: 'ace' });
    s = point(s, 'B', { tag: 'block', who: 'b2' });
    s = point(s, 'A', { tag: 'error', who: 'b1' });
    s = point(s, 'A');
    const r = buildReplay(s);
    expect(r.steps.map((x) => x.finish)).toEqual(['ace', 'block', 'error', 'kill']);
    expect(r.steps[1]).toMatchObject({ who: 'b2', sideOut: true, serving: 'A' });
    expect(r.steps[0]).toMatchObject({ serving: 'A', sideOut: false });
    expect(r.steps[3]).toMatchObject({ serving: 'A' }); // A kept serving after B's error went to A... A won twice in a row
  });
  it('names the server only in 6v6 (the rotation); never guessed elsewhere', () => {
    const six = buildReplay(point(point(fresh('25-w2-bo5', 6), 'A'), 'B'));
    expect(six.steps.map((x) => x.server)).toEqual(['a1', 'a1']);
    const two = buildReplay(point(fresh('21-w2-bo3', 2), 'A'));
    expect(two.steps[0]!.server).toBeUndefined();
  });
  it('tracks set ends, sets won, and a winner once final', () => {
    let s = fresh('11-w2-bo3');
    for (let i = 0; i < 11; i++) s = point(s, 'A');
    for (let i = 0; i < 11; i++) s = point(s, 'A');
    const mid = buildReplay(s);
    expect(mid.winner).toBeNull();
    expect(mid.steps.filter((x) => x.setEnd)).toHaveLength(2);
    expect(mid.steps.at(-1)).toMatchObject({ setsA: 2, setsB: 0, set: 2 });
    expect(mid.setScores).toEqual([{ A: 11, B: 0 }, { A: 11, B: 0 }]);
    s = ap(ap(s, { type: 'confirm_final', side: 'A' }), { type: 'confirm_final', side: 'B' });
    expect(buildReplay(s).winner).toBe('A');
  });
  it('flags the end switch after a beach side-switch rally and after a set that is not the last', () => {
    let s = fresh('21-w2-bo3', 2);
    for (let i = 0; i < 7; i++) s = point(s, 'A');
    expect(buildReplay(s).steps.map((x) => x.switched)).toEqual([false, false, false, false, false, false, true]);
  });
  it('very long matches are sped up to stay watchable but never below the minimum step', () => {
    let s = fresh('25-w2-bo5', 6);
    for (let i = 0; i < 25; i++) s = point(s, 'A');
    for (let i = 0; i < 25; i++) s = point(s, 'B');
    for (let i = 0; i < 25; i++) s = point(s, 'A');
    for (let i = 0; i < 25; i++) s = point(s, 'B');
    const r = buildReplay(s);
    expect(r.steps).toHaveLength(100);
    expect(r.steps[0]!.durationMs).toBeLessThan(REPLAY_STEP_MS);
    expect(r.steps[0]!.durationMs).toBeGreaterThanOrEqual(3000);
  });
  it('explains why there is nothing to watch for quick, voided, empty and corrected games', () => {
    const quick = ap(ap(fresh('15-w2-bo1', 2, 'quick'), { type: 'propose_final', side: 'A', sets: [{ A: 15, B: 3 }] }), { type: 'confirm_proposed', side: 'B' });
    expect(buildReplay(quick)).toMatchObject({ available: false, winner: 'A', setScores: [{ A: 15, B: 3 }] });
    expect(buildReplay(quick).note).toMatch(/Quick/);
    expect(buildReplay(fresh('11-w2-bo1')).available).toBe(false);
    expect(buildReplay(ap(fresh('11-w2-bo1'), { type: 'void', side: 'A' })).note).toMatch(/voided/);
    let c = ap(point(fresh('11-w2-bo1'), 'A'), { type: 'dispute', side: 'B', reason: 'x' });
    const sets = [{ A: 3, B: 2 }];
    c = ap(ap(c, { type: 'resolve_dispute', side: 'A', sets }), { type: 'resolve_dispute', side: 'B', sets });
    expect(buildReplay(c)).toMatchObject({ available: false });
    expect(buildReplay(c).note).toMatch(/corrected/);
  });
  it('a tampered rally list that does not add up is refused, not animated', () => {
    const s = point(point(fresh('11-w2-bo1'), 'A'), 'B');
    const bad: GameState = { ...s, points: s.points.slice(1) };
    expect(buildReplay(bad).available).toBe(false);
  });
  it('picks the sand stage for beach courts and the gym for everything else', () => {
    expect(stageFor('beach')).toBe('sand');
    for (const c of ['indoor', 'grass', 'unknown'] as const) expect(stageFor(c)).toBe('gym');
    expect(stageFor(null)).toBe('gym');
  });
});
