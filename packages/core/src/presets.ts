export const TARGETS = [7, 10, 11, 21] as const;
export type Target = (typeof TARGETS)[number];
export const SCORING_MODES = ['ones', 'onesAndTwos'] as const;
export type ScoringMode = (typeof SCORING_MODES)[number];
export const WIN_BYS = [1, 2] as const;
export type WinBy = (typeof WIN_BYS)[number];
export const TIERS = [1, 2, 3, 4, 5] as const;
export type Tier = (typeof TIERS)[number];
export type CourtType = 'full' | 'half' | 'unknown';

export interface ScoringPreset {
  id: string;
  target: Target;
  scoring: ScoringMode;
  winBy: WinBy;
  label: string;
}

export function presetId(target: Target, scoring: ScoringMode, winBy: WinBy): string {
  return `${target}-${scoring === 'ones' ? '1s' : '1s2s'}-w${winBy}`;
}

/** Full matrix: 4 targets x 2 scoring modes x 2 win-by rules = 16 presets. */
export const PRESETS: readonly ScoringPreset[] = TARGETS.flatMap((target) =>
  SCORING_MODES.flatMap((scoring) =>
    WIN_BYS.map((winBy) => ({
      id: presetId(target, scoring, winBy),
      target,
      scoring,
      winBy,
      label: `To ${target}, ${scoring === 'ones' ? 'ones only' : 'ones and twos'}, win by ${winBy}`,
    })),
  ),
);

export function getPreset(id: string): ScoringPreset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown scoring preset: ${id}`);
  return p;
}

/** Point values a side may claim in one scoring event. */
export function allowedPoints(p: ScoringPreset): readonly number[] {
  return p.scoring === 'ones' ? [1] : [1, 2];
}

/** Returns 'A' | 'B' when the game is won under the preset, else null. */
export function winner(a: number, b: number, p: ScoringPreset): 'A' | 'B' | null {
  if (a >= p.target && a - b >= p.winBy) return 'A';
  if (b >= p.target && b - a >= p.winBy) return 'B';
  return null;
}

/** True if (a, b) is a reachable final score: the last scoring event must have ended a not-yet-won game. */
export function isValidFinalScore(a: number, b: number, p: ScoringPreset): boolean {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return false;
  const w = winner(a, b, p);
  if (!w) return false;
  const [hi, lo] = w === 'A' ? [a, b] : [b, a];
  return allowedPoints(p).some((pts) => hi - pts >= 0 && winner(hi - pts, lo, p) === null);
}

export function playersPerSide(tier: Tier): number {
  return tier;
}

export function tierLabel(tier: Tier): string {
  return `${tier}v${tier}`;
}

/** 5v5 is full court only. Unknown courts must be confirmed full before 5v5. */
export function canPlayTierOnCourt(tier: Tier, court: CourtType): boolean {
  return tier < 5 || court === 'full';
}
