import { describe, expect, it } from 'vitest';
import {
  displayRating, eloExpected, eloUpdate, isProvisional, lanePolicy, lastTenHistory, newSkill, ratingLabel, rateGame, repeatWeight,
  goldForGame, stubPurchaseProvider, priorFor, overallRating, RATING_NAME,
} from '../src/index.js';

describe('elo', () => {
  it('even match is 50% and winners gain what losers lose (same K)', () => {
    expect(eloExpected(1000, 1000)).toBe(0.5);
    const w = eloUpdate({ rating: 1000, games: 20 }, 1000, 1000, true);
    const l = eloUpdate({ rating: 1000, games: 20 }, 1000, 1000, false);
    expect(w.delta).toBe(10);
    expect(l.delta).toBe(-10);
    expect(w.reason).toMatch(/Win/);
  });
  it('weight 0 leaves rating unchanged', () => {
    const u = eloUpdate({ rating: 1100, games: 3 }, 1100, 1000, true, 0);
    expect(u.rating).toBe(1100);
    expect(u.reason).toMatch(/hold/);
  });
  it('shows only the last 10 games, oldest first', () => {
    const h = Array.from({ length: 15 }, (_, i) => ({ gameId: `g${i}`, rating: 1000 + i, delta: 1, at: i }));
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
    expect(d.rating).toBe(1000);
    expect(d.range).toBe(167); // sigma 25/3 x 20 points per mu
    expect(d.label).toBe('1000 +/- 167');
    expect(RATING_NAME).toBe('Net Rating');
    expect(displayRating({ mu: 30, sigma: 5 }).rating).toBe(1100);
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

describe('formats 2v2, 4v4 and 6v6 (Net Rating)', () => {
  const team = (n: number, mu: number) => Array.from({ length: n }, () => ({ mu, sigma: 8.333 }));
  it.each([2, 4, 6])('a %i-a-side win moves winners up and losers down, equally for equal teams', (n) => {
    const r = rateGame(team(n, 25), team(n, 25), 'A');
    expect(r.A).toHaveLength(n);
    expect(r.B).toHaveLength(n);
    for (const u of r.A) expect(u.displayDelta).toBeGreaterThan(0);
    for (const u of r.B) expect(u.displayDelta).toBeLessThan(0);
    expect(r.A[0]!.displayDelta).toBe(-r.B[0]!.displayDelta);
  });
  it('mixed-rating teams: the underdog side gains more for the same win', () => {
    const strong = [{ mu: 32, sigma: 3 }, { mu: 30, sigma: 3 }];
    const weak = [{ mu: 22, sigma: 3 }, { mu: 20, sigma: 3 }];
    const upset = rateGame(strong, weak, 'B').B[0]!.displayDelta;
    const expected = rateGame(strong, weak, 'A').A[0]!.displayDelta;
    expect(upset).toBeGreaterThan(expected);
  });
  it('a stronger partner does not hide a weak player: each player is updated from their own rating', () => {
    const mixed = [{ mu: 35, sigma: 4 }, { mu: 15, sigma: 8 }];
    const r = rateGame(mixed, team(2, 25), 'A').A;
    expect(r[1]!.after.mu).not.toBe(r[0]!.after.mu);
    expect(r[1]!.after.sigma).toBeLessThan(8);
  });
});

