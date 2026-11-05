import { describe, expect, it } from 'vitest';
import { PRESETS, canPlayTierOnCourt, getPreset, isValidFinalScore, winner } from '../src/index.js';

describe('presets', () => {
  it('has the full 4x2x2 matrix with unique ids', () => {
    expect(PRESETS).toHaveLength(16);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(16);
  });
  it('win-by-2 needs a two point lead', () => {
    const p = getPreset('11-1s-w2');
    expect(winner(11, 10, p)).toBeNull();
    expect(winner(12, 10, p)).toBe('A');
    expect(winner(9, 11, p)).toBe('B');
  });
  it('win-by-1 ends at the target', () => {
    expect(winner(11, 10, getPreset('11-1s-w1'))).toBe('A');
  });
  it('validates reachable final scores', () => {
    const ones = getPreset('11-1s-w2');
    expect(isValidFinalScore(11, 5, ones)).toBe(true);
    expect(isValidFinalScore(12, 10, ones)).toBe(true);
    expect(isValidFinalScore(12, 9, ones)).toBe(false); // would have ended at 11-9
    expect(isValidFinalScore(10, 3, ones)).toBe(false);
    const twos = getPreset('11-1s2s-w1');
    expect(isValidFinalScore(12, 10, twos)).toBe(true); // 10-10 then a two... 10-10 is not a win, +2 = 12
    expect(isValidFinalScore(13, 10, twos)).toBe(false);
  });
  it('5v5 is full court only; unknown courts do not qualify', () => {
    expect(canPlayTierOnCourt(5, 'full')).toBe(true);
    expect(canPlayTierOnCourt(5, 'half')).toBe(false);
    expect(canPlayTierOnCourt(5, 'unknown')).toBe(false);
    expect(canPlayTierOnCourt(3, 'half')).toBe(true);
  });
});
