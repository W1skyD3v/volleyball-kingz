import { describe, expect, it } from 'vitest';
import {
  BEST_OFS, CASUAL_PRESET_ID, PICKUP_PRESET_ID, PRESETS, TARGETS, canPlayFormatOnCourt, getPreset, isDecidingSet, isOpenScore, isValidSetFinal,
  officialPresetId, presetId, setRuleFor, setWinner, setsToWin, switchesDuringSet,
} from '../src/index.js';

describe('preset matrix', () => {
  it('has 48 unique presets that round-trip through getPreset', () => {
    expect(PRESETS).toHaveLength(48);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(48);
    for (const p of PRESETS) expect(getPreset(p.id)).toBe(p);
    expect(() => getPreset('25-1s-w2')).toThrow();
  });
  it('only single-set presets carry a time cap, and caps only exist with win by 2', () => {
    for (const p of PRESETS) {
      if (p.timeCapMin !== null) expect(p.bestOf).toBe(1);
      if (p.cap) expect(p.winBy).toBe(2);
    }
  });
  it('names the pickup, casual and official presets', () => {
    expect(PICKUP_PRESET_ID).toBe('15-w2-bo1-t20');
    expect(getPreset(PICKUP_PRESET_ID)).toMatchObject({ target: 15, winBy: 2, cap: false, bestOf: 1, timeCapMin: 20 });
    expect(CASUAL_PRESET_ID).toBe('11-w2-bo1');
    expect(getPreset(CASUAL_PRESET_ID)).toMatchObject({ target: 11, bestOf: 1, timeCapMin: null });
    expect(officialPresetId(2)).toBe('21-w2-bo3');
    expect(officialPresetId(6)).toBe('25-w2-bo5');
    expect(getPreset(officialPresetId(2))).toMatchObject({ target: 21, winBy: 2, cap: false, bestOf: 3 });
    expect(getPreset(officialPresetId(6))).toMatchObject({ target: 25, winBy: 2, cap: false, bestOf: 5 });
  });
  it('sets needed to win a match', () => {
    expect(BEST_OFS.map((b) => setsToWin(getPreset(presetId(21, 2, false, b))))).toEqual([1, 2, 3]);
  });
});

describe('set rules', () => {
  it('beach official: sets to 21, deciding third set to 15', () => {
    const p = getPreset('21-w2-bo3');
    expect(setRuleFor(p, 1)).toMatchObject({ target: 21, deciding: false });
    expect(setRuleFor(p, 2)).toMatchObject({ target: 21, deciding: false });
    expect(setRuleFor(p, 3)).toMatchObject({ target: 15, deciding: true });
  });
  it('indoor official: sets to 25, deciding fifth set to 15', () => {
    const p = getPreset('25-w2-bo5');
    expect([1, 2, 3, 4].map((n) => setRuleFor(p, n).target)).toEqual([25, 25, 25, 25]);
    expect(setRuleFor(p, 5)).toMatchObject({ target: 15, deciding: true });
    expect(isDecidingSet(p, 4)).toBe(false);
  });
  it('a single set is never a deciding set; casual 11 never grows to 15', () => {
    expect(isDecidingSet(getPreset('25-w2-bo1'), 1)).toBe(false);
    expect(setRuleFor(getPreset('11-w2-bo3'), 3).target).toBe(11);
  });
  it('win by 2: 25-23 and 26-24 are final, 25-24 is not, 27-24 is unreachable', () => {
    const r = setRuleFor(getPreset('25-w2-bo1'), 1);
    expect(setWinner(25, 23, r)).toBe('A');
    expect(setWinner(25, 24, r)).toBeNull();
    expect(isValidSetFinal(25, 23, r)).toBe(true);
    expect(isValidSetFinal(26, 24, r)).toBe(true);
    expect(isValidSetFinal(27, 24, r)).toBe(false);
    expect(isValidSetFinal(25, 24, r)).toBe(false);
    expect(isValidSetFinal(23, 25, r)).toBe(true);
  });
  it('win by 1 ends at the target', () => {
    const r = setRuleFor(getPreset('21-w1-bo1'), 1);
    expect(setWinner(21, 20, r)).toBe('A');
    expect(isValidSetFinal(21, 20, r)).toBe(true);
    expect(isValidSetFinal(22, 20, r)).toBe(false);
  });
  it('hard cap: first to target + 5 wins even by one', () => {
    const p = getPreset('25-w2c-bo1');
    const r = setRuleFor(p, 1);
    expect(r.capPoints).toBe(30);
    expect(setWinner(30, 29, r)).toBe('A');
    expect(setWinner(29, 29, r)).toBeNull();
    expect(isValidSetFinal(30, 29, r)).toBe(true);
    expect(isValidSetFinal(30, 28, r)).toBe(true);
    expect(isValidSetFinal(31, 29, r)).toBe(false);
    expect(setRuleFor(getPreset('21-w2c-bo3'), 3).capPoints).toBe(20); // deciding target 15 + 5
  });
  it('isValidSetFinal equals "reachable by real play" for every rule (brute force)', () => {
    for (const id of ['25-w2-bo1', '21-w1-bo1', '15-w2c-bo1', '11-w2-bo1', '21-w2-bo3']) {
      const p = getPreset(id);
      for (const setNo of [1, p.bestOf]) {
        const r = setRuleFor(p, setNo);
        const N = 45;
        // reachable[a][b] = the set can be at (a, b) without having been won earlier
        const reach: boolean[][] = Array.from({ length: N + 2 }, () => Array<boolean>(N + 2).fill(false));
        reach[0]![0] = true;
        for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) {
          if (!reach[a]![b] || setWinner(a, b, r)) continue;
          reach[a + 1]![b] = true;
          reach[a]![b + 1] = true;
        }
        for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) {
          const finishedHere = reach[a]![b]! && setWinner(a, b, r) !== null;
          expect(isValidSetFinal(a, b, r), `${id} set ${setNo} ${a}-${b}`).toBe(finishedHere);
          expect(isOpenScore(a, b, r), `${id} set ${setNo} open ${a}-${b}`).toBe(reach[a]![b]! && setWinner(a, b, r) === null);
        }
      }
    }
  });
});

describe('formats and courts', () => {
  it('only beach 2v2 switches ends during a set', () => {
    expect([2, 4, 6].map(switchesDuringSet)).toEqual([true, false, false]);
  });
  it('6v6 needs an indoor or grass court; smaller formats fit anywhere', () => {
    for (const c of ['beach', 'indoor', 'grass', 'unknown'] as const) {
      expect(canPlayFormatOnCourt(2, c)).toBe(true);
      expect(canPlayFormatOnCourt(4, c)).toBe(true);
    }
    expect(canPlayFormatOnCourt(6, 'indoor')).toBe(true);
    expect(canPlayFormatOnCourt(6, 'grass')).toBe(true);
    expect(canPlayFormatOnCourt(6, 'beach')).toBe(false);
    expect(canPlayFormatOnCourt(6, 'unknown')).toBe(false);
  });
  it('every target is offered', () => {
    expect([...TARGETS]).toEqual([11, 15, 21, 25]);
  });
});
