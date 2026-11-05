import { describe, expect, it } from 'vitest';
import { applyEvent, newGame, ratingWeight, ScoringError, winnerOf, type GameEvent, type GameState } from '../src/index.js';

const run = (s: GameState, evs: GameEvent[]) => evs.reduce(applyEvent, s);
const point = (side: 'A' | 'B', points = 1): GameEvent[] => [
  { type: 'claim_point', side, points },
  { type: 'confirm_point', side: side === 'A' ? 'B' : 'A' },
];

describe('live scoring', () => {
  it('a point counts only after the other side confirms', () => {
    let s = newGame('7-1s-w1', 'live');
    s = applyEvent(s, { type: 'claim_point', side: 'A', points: 1 });
    expect(s.score.A).toBe(0);
    expect(() => applyEvent(s, { type: 'confirm_point', side: 'A' })).toThrow(ScoringError);
    s = applyEvent(s, { type: 'confirm_point', side: 'B' });
    expect(s.score.A).toBe(1);
  });
  it('rejects a 2 in ones-only and a second pending claim', () => {
    const s = newGame('7-1s-w1', 'live');
    expect(() => applyEvent(s, { type: 'claim_point', side: 'A', points: 2 })).toThrow(/not allowed/);
    const p = applyEvent(s, { type: 'claim_point', side: 'A', points: 1 });
    expect(() => applyEvent(p, { type: 'claim_point', side: 'B', points: 1 })).toThrow(/already/);
  });
  it('plays a full game to final with both confirmations', () => {
    let s = newGame('7-1s-w1', 'live');
    for (let i = 0; i < 7; i++) s = run(s, point('A'));
    expect(s.status).toBe('awaiting_final');
    s = applyEvent(s, { type: 'confirm_final', side: 'A' });
    expect(s.status).toBe('awaiting_final');
    expect(ratingWeight(s)).toBe(0);
    s = applyEvent(s, { type: 'confirm_final', side: 'B' });
    expect(s.status).toBe('final');
    expect(winnerOf(s)).toBe('A');
    expect(ratingWeight(s)).toBe(1);
  });
  it('win-by-2 continues past the target', () => {
    let s = newGame('7-1s-w2', 'live');
    for (let i = 0; i < 6; i++) s = run(s, [...point('A'), ...point('B')].slice(0, 2));
    // 6-0 so far; get B to 6
    for (let i = 0; i < 6; i++) s = run(s, point('B'));
    s = run(s, point('A'));
    expect(s.score).toEqual({ A: 7, B: 6 });
    expect(s.status).toBe('active');
    s = run(s, point('A'));
    expect(s.status).toBe('awaiting_final');
  });
  it('dispute freezes the game until both sides agree on a score', () => {
    let s = newGame('11-1s2s-w1', 'live');
    s = run(s, point('A', 2));
    s = applyEvent(s, { type: 'claim_point', side: 'B', points: 1 });
    s = applyEvent(s, { type: 'dispute', side: 'A', reason: 'travelled' });
    expect(s.status).toBe('disputed');
    expect(() => applyEvent(s, { type: 'claim_point', side: 'A', points: 1 })).toThrow();
    s = applyEvent(s, { type: 'resolve_dispute', side: 'A', score: { A: 2, B: 0 } });
    expect(s.status).toBe('disputed');
    s = applyEvent(s, { type: 'resolve_dispute', side: 'B', score: { A: 2, B: 1 } });
    expect(s.status).toBe('disputed'); // disagreement stays frozen
    expect(ratingWeight(s)).toBe(0);
    s = applyEvent(s, { type: 'resolve_dispute', side: 'B', score: { A: 2, B: 0 } });
    expect(s.status).toBe('active');
    expect(s.score).toEqual({ A: 2, B: 0 });
    expect(s.pending).toBeNull();
  });
  it('a disputed final goes back to awaiting_final when the agreed score is a win', () => {
    let s = newGame('7-1s-w1', 'live');
    for (let i = 0; i < 7; i++) s = run(s, point('A'));
    s = applyEvent(s, { type: 'dispute', side: 'B', reason: 'wrong score' });
    s = applyEvent(s, { type: 'resolve_dispute', side: 'A', score: { A: 7, B: 3 } });
    s = applyEvent(s, { type: 'resolve_dispute', side: 'B', score: { A: 7, B: 3 } });
    expect(s.status).toBe('awaiting_final');
  });
  it('void is terminal', () => {
    const s = applyEvent(newGame('7-1s-w1', 'live'), { type: 'void', side: 'A' });
    expect(() => applyEvent(s, { type: 'claim_point', side: 'A', points: 1 })).toThrow(/voided/);
  });
});

describe('quick scoring', () => {
  it('end-only confirm', () => {
    let s = newGame('11-1s-w2', 'quick');
    expect(() => applyEvent(s, { type: 'claim_point', side: 'A', points: 1 })).toThrow(/Live mode/);
    s = applyEvent(s, { type: 'propose_final', side: 'A', score: { A: 11, B: 4 } });
    expect(() => applyEvent(s, { type: 'confirm_proposed', side: 'A' })).toThrow();
    s = applyEvent(s, { type: 'confirm_proposed', side: 'B' });
    expect(s.status).toBe('final');
    expect(winnerOf(s)).toBe('A');
  });
  it('rejects impossible finals and honours dispute', () => {
    let s = newGame('11-1s-w2', 'quick');
    expect(() => applyEvent(s, { type: 'propose_final', side: 'A', score: { A: 10, B: 4 } })).toThrow(/valid/);
    s = applyEvent(s, { type: 'propose_final', side: 'A', score: { A: 11, B: 4 } });
    s = applyEvent(s, { type: 'dispute', side: 'B', reason: 'we won' });
    expect(s.status).toBe('disputed');
    expect(ratingWeight(s)).toBe(0);
    // the freeze holds: the disputed proposal can no longer be confirmed
    expect(() => applyEvent(s, { type: 'confirm_proposed', side: 'B' })).toThrow(/disputed/);
  });
});

describe('lobby (consent before play)', () => {
  it('nothing can be scored until the game starts', () => {
    const lobby = newGame('7-1s-w1', 'live', { lobby: true });
    expect(lobby.status).toBe('lobby');
    expect(() => applyEvent(lobby, { type: 'claim_point', side: 'A', points: 1 })).toThrow();
    expect(() => applyEvent(lobby, { type: 'dispute', side: 'A', reason: 'x' })).toThrow();
    expect(ratingWeight(lobby)).toBe(0);
    const live = applyEvent(lobby, { type: 'start' });
    expect(live.status).toBe('active');
    expect(() => applyEvent(live, { type: 'start' })).toThrow(/already started/);
    expect(applyEvent(live, { type: 'claim_point', side: 'A', points: 1 }).pending).not.toBeNull();
  });
  it('a lobby can be cancelled but a cancelled game earns nothing', () => {
    const v = applyEvent(newGame('7-1s-w1', 'quick', { lobby: true }), { type: 'void', side: 'A' });
    expect(v.status).toBe('voided');
    expect(ratingWeight(v)).toBe(0);
  });
});

describe('void needs both captains once play has started', () => {
  const started = () => {
    let s = newGame('11-1s-w1', 'live');
    s = applyEvent(s, { type: 'claim_point', side: 'A', points: 1 });
    return applyEvent(s, { type: 'confirm_point', side: 'B' }); // 1-0 to A
  };
  it('a clean 0-0 game can be voided by either captain at once', () => {
    expect(applyEvent(newGame('11-1s-w1', 'live'), { type: 'void', side: 'B' }).status).toBe('voided');
  });
  it('the losing side cannot erase a game on its own; it only records a request', () => {
    const s = applyEvent(started(), { type: 'void', side: 'B' });
    expect(s.status).toBe('active');
    expect(s.voidRequest).toEqual({ by: 'B' });
    expect(applyEvent(s, { type: 'void', side: 'B' }).status).toBe('active'); // asking twice changes nothing
  });
  it('the other captain agreeing voids it, and a voided game earns nothing', () => {
    const asked = applyEvent(started(), { type: 'void', side: 'B' });
    const v = applyEvent(asked, { type: 'void', side: 'A' });
    expect(v.status).toBe('voided');
    expect(ratingWeight(v)).toBe(0);
  });
  it('a pending point also counts as play having started', () => {
    const s = applyEvent(newGame('11-1s-w1', 'live'), { type: 'claim_point', side: 'A', points: 1 });
    expect(applyEvent(s, { type: 'void', side: 'B' }).status).toBe('active');
  });
  it('a disputed game can still be voided, but only by agreement', () => {
    let s = applyEvent(started(), { type: 'dispute', side: 'B', reason: 'x' });
    s = applyEvent(s, { type: 'void', side: 'B' });
    expect(s.status).toBe('disputed');
    expect(applyEvent(s, { type: 'void', side: 'A' }).status).toBe('voided');
  });
});
