import { rate, rating as osRating } from 'openskill';
import type { Tier } from './presets.js';

export type Lane = 'casual' | 'private' | 'ranked';

export const ELO_START = 1200;
export const PROVISIONAL_MIN_GAMES = 10;
export const PROVISIONAL_MIN_OPPONENTS = 5;

// ---------------------------------------------------------------- Elo

export function eloExpected(own: number, opp: number): number {
  return 1 / (1 + 10 ** ((opp - own) / 400));
}

export const eloK = (games: number): number => (games < PROVISIONAL_MIN_GAMES ? 32 : 20);

export interface EloEntry {
  rating: number;
  games: number;
}

export interface EloUpdate {
  rating: number;
  delta: number;
  reason: string;
}

/** Team Elo: side rating is the mean of its players. `weight` scales the change (0 = no change). */
export function eloUpdate(own: EloEntry, ownTeamAvg: number, oppTeamAvg: number, won: boolean, weight = 1): EloUpdate {
  const exp = eloExpected(ownTeamAvg, oppTeamAvg);
  const raw = eloK(own.games) * ((won ? 1 : 0) - exp) * weight;
  const delta = Math.round(raw * 10) / 10;
  const pct = Math.round(exp * 100);
  const reason =
    weight === 0
      ? 'No change: result is on hold'
      : `${won ? 'Win' : 'Loss'} vs a side you were ${pct}% to beat${weight < 1 ? ' (reduced: repeat opponents/teammates)' : ''}`;
  return { rating: Math.round((own.rating + delta) * 10) / 10, delta, reason };
}

export interface EloHistoryPoint {
  gameId: string;
  rating: number;
  delta: number;
  at: number;
}

/** Private lane shows Elo history of the last 10 games. */
export function lastTenHistory(history: EloHistoryPoint[]): EloHistoryPoint[] {
  return [...history].sort((a, b) => a.at - b.at).slice(-10);
}

// ---------------------------------------------------------------- OpenSkill (Plackett-Luce)

export interface SkillRating {
  mu: number;
  sigma: number;
}

export const newSkill = (): SkillRating => {
  const r = osRating();
  return { mu: r.mu, sigma: r.sigma };
};

export const DEFAULT_SIGMA = 25 / 3;
export const PRIOR_SIGMA_FACTOR = 1.5;
export const PRIOR_SIGMA_FLOOR = 5;
const PRIOR_GAMES_CAP = 30;

export interface TierSkill extends SkillRating {
  games: number;
}

/**
 * Cold start: a player's first game in a new tier starts from what the player's other tiers say, not from a stranger's 1200.
 * mu = games-weighted mean (weight = min(games, 30)); sigma = 1.5 x the weighted mean sigma, kept between 5 and the default.
 * Mirrored by public.vk_prior_from in SQL (fuzz-tested). With no history: the default rating.
 */
export function priorFor(existing: TierSkill[]): SkillRating {
  const used = existing.filter((e) => e.games > 0);
  const total = used.reduce((t, e) => t + Math.min(e.games, PRIOR_GAMES_CAP), 0);
  if (total === 0) return newSkill();
  const mean = (f: (e: TierSkill) => number) => used.reduce((t, e) => t + Math.min(e.games, PRIOR_GAMES_CAP) * f(e), 0) / total;
  return { mu: mean((e) => e.mu), sigma: Math.min(DEFAULT_SIGMA, Math.max(PRIOR_SIGMA_FLOOR, PRIOR_SIGMA_FACTOR * mean((e) => e.sigma))) };
}

/**
 * Overall rating: display-only, derived from tier ratings (same weights as the prior). Never used for matchmaking.
 * Hidden (null) until at least one tier has 10+ games.
 */
export function overallRating(tiers: TierSkill[]): { rating: number; tiers: number } | null {
  if (!tiers.some((t) => t.games >= PROVISIONAL_MIN_GAMES)) return null;
  const p = priorFor(tiers);
  return { rating: displayRating(p).rating, tiers: tiers.filter((t) => t.games > 0).length };
}

/** Display scale: mu 25 -> 1200. 1 mu = 24 points; range = +/- sigma on the same scale. */
const DISPLAY_PER_MU = 24;

export interface DisplayRating {
  rating: number;
  range: number;
  label: string; // "1200 +/- 200"
}

export function displayRating(s: SkillRating): DisplayRating {
  const rating = Math.round(ELO_START + (s.mu - 25) * DISPLAY_PER_MU);
  const range = Math.round(s.sigma * DISPLAY_PER_MU);
  return { rating, range, label: `${rating} +/- ${range}` };
}

export interface PlayerStats {
  games: number;
  distinctOpponents: number;
}

export function isProvisional(p: PlayerStats): boolean {
  return p.games < PROVISIONAL_MIN_GAMES || p.distinctOpponents < PROVISIONAL_MIN_OPPONENTS;
}

export function ratingLabel(s: SkillRating, p: PlayerStats): string {
  const d = displayRating(s).label;
  return isProvisional(p) ? `${d} (provisional)` : d;
}

/**
 * Reduced gain for repeats. Counts are games in the recent window (caller decides the window)
 * against the same opponents / with the same teammates, before this game.
 * 1.0 at 0 repeats, down to a 0.25 floor.
 */
export function repeatWeight(repeatOpponentGames: number, repeatTeammateGames: number): number {
  const f = (n: number) => Math.max(0.25, 1 - 0.15 * Math.max(0, n));
  return Math.round(f(repeatOpponentGames) * f(repeatTeammateGames) * 1000) / 1000;
}

export interface SkillUpdate {
  before: SkillRating;
  after: SkillRating;
  displayDelta: number;
  reason: string;
}

/** Blend a raw update toward the old rating. weight 0 = unchanged (use for disputed games); <1 for repeat opponents/teammates. */
export function blendUpdate(before: SkillRating, after: SkillRating, weight: number, won: boolean): SkillUpdate {
  const blended: SkillRating = { mu: before.mu + (after.mu - before.mu) * weight, sigma: before.sigma + (after.sigma - before.sigma) * weight };
  const dd = displayRating(blended).rating - displayRating(before).rating;
  const reason =
    weight === 0
      ? 'No change: result is on hold'
      : `${won ? 'Win' : 'Loss'}: ${dd >= 0 ? '+' : ''}${dd}${weight < 1 ? ' (reduced: repeat opponents/teammates)' : ''}`;
  return { before, after: blended, displayDelta: dd, reason };
}

/** Raw Plackett-Luce result per player at full weight. Apply per-player weights with blendUpdate. */
export function rateRaw(teamA: SkillRating[], teamB: SkillRating[], win: 'A' | 'B'): { A: SkillRating[]; B: SkillRating[] } {
  const result = rate([teamA.map((x) => ({ ...x })), teamB.map((x) => ({ ...x }))], { rank: win === 'A' ? [1, 2] : [2, 1] });
  return { A: result[0]!.map((r) => ({ mu: r.mu, sigma: r.sigma })), B: result[1]!.map((r) => ({ mu: r.mu, sigma: r.sigma })) };
}

/**
 * Rate one finished game with Plackett-Luce. teamA/teamB are arrays of ratings; winner is the winning side.
 * Returns per-player updates in input order. `weight` blends new toward old (0 = unchanged); use 0 for disputed games.
 * Takes no currency/purchase input by design: bought Gold must never affect rating.
 */
export function rateGame(
  teamA: SkillRating[],
  teamB: SkillRating[],
  win: 'A' | 'B',
  weight = 1,
): { A: SkillUpdate[]; B: SkillUpdate[] } {
  const raw = rateRaw(teamA, teamB, win);
  return {
    A: teamA.map((b, i) => blendUpdate(b, raw.A[i]!, weight, win === 'A')),
    B: teamB.map((b, i) => blendUpdate(b, raw.B[i]!, weight, win === 'B')),
  };
}

// ---------------------------------------------------------------- Per-tier book

/** Each tier (1v1..5v5) has its own independent rating. */
export type TierBook<T> = Partial<Record<Tier, T>>;

export function getTier<T>(book: TierBook<T>, tier: Tier, make: () => T): T {
  return book[tier] ?? make();
}

/**
 * Whether a finished game of this lane moves which rating.
 * casual -> nothing unless the player opted in to Casual Elo (separate from ranked).
 * private -> Elo history only (friends, shown as last 10).
 * ranked -> OpenSkill per tier, requires check-in at the court.
 */
export function lanePolicy(lane: Lane, opts: { casualEloOptIn?: boolean; checkedIn?: boolean }): 'none' | 'casual_elo' | 'private_elo' | 'ranked_skill' {
  switch (lane) {
    case 'casual':
      return opts.casualEloOptIn ? 'casual_elo' : 'none';
    case 'private':
      return 'private_elo';
    case 'ranked':
      return opts.checkedIn ? 'ranked_skill' : 'none';
  }
}

/** Log-only tier usage (no limit enforced in the draft). */
export interface TierUsageEvent {
  userId: string;
  lane: Lane;
  tier: Tier;
  at: number;
}
export function tierUsageEvent(userId: string, lane: Lane, tier: Tier, at = Date.now()): TierUsageEvent {
  return { userId, lane, tier, at };
}
