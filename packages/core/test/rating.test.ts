import { describe, expect, it } from 'vitest';
import {
  displayRating, eloExpected, eloUpdate, isProvisional, lanePolicy, lastTenHistory, newSkill, ratingLabel, rateGame, repeatWeight,
  goldForGame, stubPurchaseProvider, priorFor, overallRating,
} from '../src/index.js';

describe('elo', () => {
  it('even match is 50% and winners gain what losers lose (same K)', () => {
    expect(eloExpected(1200, 1200)).toBe(0.5);
    const w = eloUpdate({ rating: 1200, games: 20 }, 1200, 1200, true);
    const l = eloUpdate({ rating: 1200, games: 20 }, 1200, 1200, false);
    expect(w.delta).toBe(10);
    expect(l.delta).toBe(-10);
    expect(w.reason).toMatch(/Win/);
  });
  it('weight 0 leaves rating unchanged', () => {
    const u = eloUpdate({ rating: 1300, games: 3 }, 1300, 1200, true, 0);
    expect(u.rating).toBe(1300);
    expect(u.reason).toMatch(/hold/);
  });
  it('shows only the last 10 games, oldest first', () => {
    const h = Array.from({ length: 15 }, (_, i) => ({ gameId: `g${i}`, rating: 1200 + i, delta: 1, at: i }));
    const t = lastTenHistory(h.reverse());
    expect(t).toHaveLength(10);
    expect(t[0]!.gameId).toBe('g5');
    expect(t[9]!.gameId).toBe('g14');
  });
});

describe('openskill plackett-luce', () => {
  it('winners go up, losers go down, uncertainty shrinks', () => {
    const a = [newSkill(), newSkill()];
    const b = [newSkill(), newSkill()];
    const r = rateGame(a, b, 'A');
    expect(r.A[0]!.after.mu).toBeGreaterThan(a[0]!.mu);
    expect(r.B[0]!.after.mu).toBeLessThan(b[0]!.mu);
    expect(r.A[0]!.after.sigma).toBeLessThan(a[0]!.sigma);
    expect(r.A[0]!.displayDelta).toBeGreaterThan(0);
    expect(r.B[0]!.reason).toMatch(/Loss/);
  });
  it('weight 0 (disputed) changes nothing; partial weight shrinks the change', () => {
    const a = [newSkill()];
    const b = [newSkill()];
    const full = rateGame(a, b, 'A', 1).A[0]!;
    const half = rateGame(a, b, 'A', 0.5).A[0]!;
    const none = rateGame(a, b, 'A', 0).A[0]!;
    expect(none.after).toEqual(a[0]);
    expect(half.after.mu - a[0]!.mu).toBeCloseTo((full.after.mu - a[0]!.mu) / 2, 6);
  });
  it('displays "rating +/- range" and the provisional label', () => {
    const d = displayRating(newSkill());
    expect(d.rating).toBe(1200);
    expect(d.label).toBe(`1200 +/- ${d.range}`);
    expect(ratingLabel(newSkill(), { games: 2, distinctOpponents: 2 })).toMatch(/provisional/);
    expect(ratingLabel(newSkill(), { games: 12, distinctOpponents: 6 })).not.toMatch(/provisional/);
    expect(isProvisional({ games: 12, distinctOpponents: 4 })).toBe(true);
  });
  it('ratings are independent per tier objects (no shared mutation)', () => {
    const t1 = newSkill();
    const t3 = newSkill();
    rateGame([t1], [newSkill()], 'A');
    expect(t3).toEqual(newSkill());
  });
});

describe('repeat weight', () => {
  it('declines with repeats and floors at 0.25', () => {
    expect(repeatWeight(0, 0)).toBe(1);
    expect(repeatWeight(2, 0)).toBeCloseTo(0.7);
    expect(repeatWeight(50, 0)).toBe(0.25);
    expect(repeatWeight(2, 2)).toBeLessThan(repeatWeight(2, 0));
  });
});

describe('lanes', () => {
  it('casual is unrated unless opted in; ranked needs check-in', () => {
    expect(lanePolicy('casual', {})).toBe('none');
    expect(lanePolicy('casual', { casualEloOptIn: true })).toBe('casual_elo');
    expect(lanePolicy('private', {})).toBe('private_elo');
    expect(lanePolicy('ranked', { checkedIn: false })).toBe('none');
    expect(lanePolicy('ranked', { checkedIn: true })).toBe('ranked_skill');
  });
});

describe('gold', () => {
  it('earns only for finalized games and respects the daily cap', () => {
    expect(goldForGame({ lane: 'casual', finalized: false, earnedToday: 0 })).toBe(0);
    expect(goldForGame({ lane: 'ranked', finalized: true, earnedToday: 0 })).toBe(15);
    expect(goldForGame({ lane: 'ranked', finalized: true, earnedToday: 95 })).toBe(5);
    expect(goldForGame({ lane: 'ranked', finalized: true, earnedToday: 100 })).toBe(0);
  });
  it('purchase stub refuses', async () => {
    expect(await stubPurchaseProvider.listProducts()).toEqual([]);
    await expect(stubPurchaseProvider.purchase('x')).rejects.toThrow();
  });
});

describe('cold-start prior and overall rating', () => {
  it('no history gives the default rating', () => {
    expect(priorFor([])).toEqual(newSkill());
    expect(priorFor([{ mu: 30, sigma: 3, games: 0 }])).toEqual(newSkill());
  });
  it('starts a new tier from the weighted mean of the others, with a wider range than the established one', () => {
    const p = priorFor([{ mu: 30, sigma: 3, games: 30 }]);
    expect(p.mu).toBe(30);
    expect(p.sigma).toBe(5); // 1.5 x 3 = 4.5, floored at 5
    const q = priorFor([{ mu: 30, sigma: 6, games: 10 }, { mu: 20, sigma: 6, games: 30 }]);
    expect(q.mu).toBeCloseTo((10 * 30 + 30 * 20) / 40, 10);
    expect(q.sigma).toBeCloseTo(8.333333, 4); // 1.5 x 6 = 9 -> capped at the default sigma
  });
  it('weights stop growing at 30 games', () => {
    const p = priorFor([{ mu: 30, sigma: 4, games: 30 }, { mu: 20, sigma: 4, games: 300 }]);
    expect(p.mu).toBe(25);
  });
  it('overall is hidden until one tier has 10 games, then shows the blended display rating', () => {
    expect(overallRating([{ mu: 30, sigma: 4, games: 9 }])).toBeNull();
    expect(overallRating([])).toBeNull();
    const o = overallRating([{ mu: 30, sigma: 4, games: 12 }, { mu: 25, sigma: 8, games: 3 }])!;
    expect(o.tiers).toBe(2);
    expect(o.rating).toBe(displayRating({ mu: (12 * 30 + 3 * 25) / 15, sigma: 1 }).rating);
  });
});
