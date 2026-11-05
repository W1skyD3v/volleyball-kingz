import { describe, expect, it } from 'vitest';
import { DAILY_EARN_CAP, GOLD_FIRST_GAME_BONUS, GOLD_WEEKLY_GOAL, goldBreakdown, goldForGame } from '../src/gold.js';

const base = { lane: 'casual' as const, finalized: true, earnedToday: 0, firstGameOfDay: false, weeklyGoalHit: false };

describe('goldForGame', () => {
  it('pays 10 casual/private and 15 ranked', () => {
    expect(goldForGame(base)).toBe(10);
    expect(goldForGame({ ...base, lane: 'private' })).toBe(10);
    expect(goldForGame({ ...base, lane: 'ranked' })).toBe(15);
  });
  it('pays nothing for an unconfirmed game', () => {
    expect(goldForGame({ ...base, finalized: false, firstGameOfDay: true, weeklyGoalHit: true })).toBe(0);
  });
  it('adds +10 for the first game of the day and +50 for the weekly goal', () => {
    expect(GOLD_FIRST_GAME_BONUS).toBe(10);
    expect(GOLD_WEEKLY_GOAL).toBe(50);
    expect(goldBreakdown({ ...base, firstGameOfDay: true })).toEqual({ game: 10, firstGame: 10, weekly: 0, total: 20 });
    expect(goldBreakdown({ ...base, lane: 'ranked', firstGameOfDay: true, weeklyGoalHit: true })).toEqual({ game: 15, firstGame: 10, weekly: 50, total: 75 });
  });
  it('never exceeds the daily cap, base first then bonuses', () => {
    expect(DAILY_EARN_CAP).toBe(100);
    expect(goldBreakdown({ ...base, earnedToday: 95, firstGameOfDay: true })).toEqual({ game: 5, firstGame: 0, weekly: 0, total: 5 });
    expect(goldForGame({ ...base, earnedToday: 100 })).toBe(0);
    expect(goldForGame({ ...base, earnedToday: 140 })).toBe(0);
  });
});
