import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { defaultAvatarConfig } from '@vk/avatar';
import { applyEvent, defaultLoadout, newGame, type GameEvent, type GameState, type Side } from '@vk/core';
import { Replay } from '../src/ui/Replay';
import type { TeamPlayer } from '../src/ui/teams';

const play = (s: GameState, evs: GameEvent[]) => evs.reduce((st, e) => applyEvent(st, e), s);
const basket = (side: Side, points = 1, scorer?: string): GameEvent[] => [{ type: 'claim_point', side, points, ...(scorer ? { scorer } : {}) }, { type: 'confirm_point', side: side === 'A' ? 'B' : 'A' }];
const text = (id: string) => [screen.getByTestId(id).props.children].flat().join('');
const player = (id: string): TeamPlayer => ({ id, name: id, config: defaultAvatarConfig(id), loadout: defaultLoadout() });
const teams = (n = 1): Record<Side, TeamPlayer[]> => ({ A: Array.from({ length: n }, (_, i) => player(`a${i}`)), B: Array.from({ length: n }, (_, i) => player(`b${i}`)) });
const props = (state: GameState, n = 1) => ({ state, mySide: 'A' as const, teams: teams(n) });

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('replay viewer', () => {
  it('plays each basket for about 7 seconds, updates the score when the ball goes in, and ends on the final result', () => {
    const s = play(newGame('7-1s-w1', 'live'), [...basket('A'), ...basket('B'), ...basket('A')]);
    render(<Replay {...props(s)} />);
    expect(text('replay-score')).toContain('0 : 0');
    act(() => jest.advanceTimersByTime(3000));
    expect(text('replay-score')).toContain('0 : 0'); // still driving to the hoop: not scored yet
    act(() => jest.advanceTimersByTime(3000)); // 6 s: through the net
    expect(text('replay-score')).toContain('1 : 0');
    act(() => jest.advanceTimersByTime(7000)); // second basket scores for them
    expect(text('replay-score')).toContain('1 : 1');
    act(() => jest.advanceTimersByTime(7000));
    expect(text('replay-score')).toContain('2 : 1');
    act(() => jest.advanceTimersByTime(20_000));
    expect(text('replay-score')).toContain('2 : 1');
  });

  it('says who won when a finished game ends, and can be watched again', () => {
    let s = newGame('7-1s-w1', 'live');
    for (let i = 0; i < 7; i++) s = play(s, basket('A'));
    expect(s.status).not.toBe('active');
    render(<Replay {...props(s)} />);
    act(() => jest.advanceTimersByTime(120_000));
    expect(text('replay-step')).toBe('You won!');
    expect(text('replay-score')).toContain('7 : 0');
    fireEvent.press(screen.getByTestId('replay-again'));
    act(() => jest.advanceTimersByTime(7000));
    expect(text('replay-score')).toContain('1 : 0');
  });

  it('skip jumps to the final score; 2x halves the wait', () => {
    const s = play(newGame('7-1s-w1', 'live'), [...basket('A'), ...basket('A')]);
    render(<Replay {...props(s)} />);
    fireEvent.press(screen.getByTestId('replay-speed'));
    act(() => jest.advanceTimersByTime(3500)); // 7 s of replay at 2x
    expect(text('replay-score')).toContain('1 : 0');
    fireEvent.press(screen.getByTestId('replay-skip'));
    expect(text('replay-score')).toContain('2 : 0');
  });

  it('names the shooter only when the captain said who scored', () => {
    const s = play(newGame('7-1s-w1', 'live'), [...basket('A', 1, 'a1'), ...basket('A', 1)]);
    render(<Replay {...props(s, 2)} />);
    act(() => jest.advanceTimersByTime(1000));
    expect(text('replay-step')).toContain('a1');
    act(() => jest.advanceTimersByTime(7000));
    expect(text('replay-step')).not.toContain('a1');
    expect(text('replay-step')).toContain('Your team');
  });

  it('a game with nothing to animate explains why instead of an empty stage', () => {
    let q = newGame('7-1s-w1', 'quick');
    q = play(q, [{ type: 'propose_final', side: 'A', score: { A: 7, B: 2 } }, { type: 'confirm_proposed', side: 'B' }]);
    render(<Replay {...props(q)} onClose={() => undefined} />);
    expect(text('replay-note')).toMatch(/final score/i);
    expect(screen.queryByTestId('replay-score')).toBeNull();
    const empty = render(<Replay {...props(newGame('7-1s-w1', 'live'))} />);
    expect(empty.getByTestId('replay-note').props.children).toMatch(/No baskets/);
  });

  it('stops its timers when it goes away (no updates after unmount)', () => {
    const s = play(newGame('7-1s-w1', 'live'), [...basket('A'), ...basket('A')]);
    const r = render(<Replay {...props(s)} />);
    r.unmount();
    expect(() => act(() => jest.advanceTimersByTime(30_000))).not.toThrow();
  });
});
