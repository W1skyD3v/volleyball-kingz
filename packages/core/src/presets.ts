/**
 * Volleyball scoring presets. Rally scoring always: every rally gives one point to its winner.
 * Spec: docs/SPORT_DESIGN.md section 2. Mirrored in SQL by vk_preset / vk_set_winner / vk_set_valid_final.
 */
export const TARGETS = [11, 15, 21, 25] as const;
export type Target = (typeof TARGETS)[number];
export const WIN_BYS = [1, 2] as const;
export type WinBy = (typeof WIN_BYS)[number];
export const BEST_OFS = [1, 3, 5] as const;
export type BestOf = (typeof BEST_OFS)[number];
/** Players per side: beach 2v2, 4v4, indoor 6v6. Internally called `tier` (kept from the shared engine). */
export const TIERS = [2, 4, 6] as const;
export type Tier = (typeof TIERS)[number];
export const COURT_TYPES = ['beach', 'indoor', 'grass', 'unknown'] as const;
export type CourtType = (typeof COURT_TYPES)[number];

/** The deciding set is played to this many points (or the match target, if lower). */
export const DECIDING_TARGET = 15;
/** A hard cap sits this many points above the set's target. */
export const CAP_ABOVE_TARGET = 5;
/** Beach side switches: every 7 points, every 5 in the deciding set. */
export const SWITCH_EVERY = 7;
export const SWITCH_EVERY_DECIDING = 5;
export const TIMEOUTS_PER_SET = 2;
/** Pickup time cap in minutes (server time). Only single-set presets can have one. */
export const PICKUP_TIME_CAP_MIN = 20;

export interface ScoringPreset {
  id: string;
  target: Target;
  winBy: WinBy;
  /** Hard cap (target + 5): the first side to reach it wins even by one point. Only with win by 2. */
  cap: boolean;
  bestOf: BestOf;
  /** Time cap in minutes from kick-off (server time), or null. At the cap the higher score wins; a tie plays to the next point. */
  timeCapMin: number | null;
  label: string;
}

/** The rule one particular set is played under. */
export interface SetRule {
  target: number;
  winBy: WinBy;
  /** Absolute cap score, or null. */
  capPoints: number | null;
  deciding: boolean;
}

export function presetId(target: Target, winBy: WinBy, cap: boolean, bestOf: BestOf, timeCapMin: number | null = null): string {
  return `${target}-w${winBy}${cap ? 'c' : ''}-bo${bestOf}${timeCapMin !== null ? `-t${timeCapMin}` : ''}`;
}

const label = (target: number, winBy: WinBy, cap: boolean, bestOf: BestOf, timeCapMin: number | null): string => {
  const win = winBy === 1 ? 'win by 1' : cap ? `win by 2, cap ${target + CAP_ABOVE_TARGET}` : 'win by 2';
  const len = bestOf === 1 ? 'one set' : `best of ${bestOf}`;
  return `To ${target}, ${win}, ${len}${timeCapMin !== null ? `, ${timeCapMin} min time cap` : ''}`;
};

/**
 * Full matrix: 4 targets x (win by 1 | win by 2 | win by 2 with cap) x 3 match lengths = 36 presets,
 * plus each single-set preset with the 20 minute pickup time cap = 12 more (48).
 */
export const PRESETS: readonly ScoringPreset[] = TARGETS.flatMap((target) =>
  ([[1, false], [2, false], [2, true]] as const).flatMap(([winBy, cap]) =>
    BEST_OFS.flatMap((bestOf) =>
      (bestOf === 1 ? [null, PICKUP_TIME_CAP_MIN] : [null]).map((t) => ({
        id: presetId(target, winBy, cap, bestOf, t),
        target, winBy, cap, bestOf, timeCapMin: t,
        label: label(target, winBy, cap, bestOf, t),
      })),
    ),
  ),
);

export function getPreset(id: string): ScoringPreset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown scoring preset: ${id}`);
  return p;
}

/** Pickup default: one set to 15, win by 2, 20 minute time cap (server time). */
export const PICKUP_PRESET_ID = presetId(15, 2, false, 1, PICKUP_TIME_CAP_MIN);
/** Casual 11-point single set, win by 2, no time cap. */
export const CASUAL_PRESET_ID = presetId(11, 2, false, 1);
/**
 * Official presets. Beach 2v2: best of 3, sets to 21, deciding set to 15, win by 2, no cap, sides switch every 7 (5 in the deciding set).
 * Indoor 6v6: best of 5, sets to 25, deciding fifth to 15, win by 2, sides switch only between sets. 4v4 uses the beach match shape.
 */
export const officialPresetId = (tier: Tier): string => (tier === 6 ? presetId(25, 2, false, 5) : presetId(21, 2, false, 3));

/** Set wins needed to take the match. */
export const setsToWin = (p: ScoringPreset): number => Math.ceil(p.bestOf / 2);

/** The deciding set is the last possible set of a multi-set match (reachable only at 1-1 or 2-2). */
export const isDecidingSet = (p: ScoringPreset, setNo: number): boolean => p.bestOf > 1 && setNo === p.bestOf;

export function setRuleFor(p: ScoringPreset, setNo: number): SetRule {
  const deciding = isDecidingSet(p, setNo);
  const target = deciding ? Math.min(DECIDING_TARGET, p.target) : p.target;
  return { target, winBy: p.winBy, capPoints: p.cap ? target + CAP_ABOVE_TARGET : null, deciding };
}

/** 'A' | 'B' when the set is won at (a, b) under the rule, else null. */
export function setWinner(a: number, b: number, r: SetRule): 'A' | 'B' | null {
  const side = (hi: number, lo: number): boolean => (hi >= r.target && hi - lo >= r.winBy) || (r.capPoints !== null && hi >= r.capPoints && hi > lo);
  if (side(a, b)) return 'A';
  if (side(b, a)) return 'B';
  return null;
}

/**
 * True if the set can be in progress at (a, b): not won, and reachable without someone having won earlier.
 * (Under win by 1 a tie at the target, and under a cap any score at the cap, can never be on the board.)
 */
export function isOpenScore(a: number, b: number, r: SetRule): boolean {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return false;
  if (setWinner(a, b, r) !== null) return false;
  const hi = Math.max(a, b);
  if (r.winBy === 1 && hi >= r.target) return false; // an unwon score at or past the target can only be a tie, which cannot be reached
  if (r.capPoints !== null && hi >= r.capPoints) return false;
  return true;
}

/** True if (a, b) is a reachable final set score: won at (a, b), one point earlier it was still open. */
export function isValidSetFinal(a: number, b: number, r: SetRule): boolean {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return false;
  const w = setWinner(a, b, r);
  if (!w) return false;
  return w === 'A' ? a - 1 >= 0 && isOpenScore(a - 1, b, r) : b - 1 >= 0 && isOpenScore(a, b - 1, r);
}

export const playersPerSide = (tier: Tier): number => tier;

export function tierLabel(tier: Tier): string {
  return tier === 2 ? 'Beach 2v2' : tier === 4 ? '4v4' : 'Indoor 6v6';
}

/** Beach 2v2 switches ends during a set; every format switches between sets. */
export const switchesDuringSet = (tier: number): boolean => tier === 2;

/**
 * 2v2 and 4v4 can be played on any court. 6v6 needs an indoor or grass court (a beach court is 8 x 16 m, too small).
 * An unknown court cannot host 6v6 until someone confirms what it is.
 */
export function canPlayFormatOnCourt(tier: Tier, court: CourtType): boolean {
  return tier < 6 || court === 'indoor' || court === 'grass';
}
