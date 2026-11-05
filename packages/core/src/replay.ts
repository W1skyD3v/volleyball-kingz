import type { GameState, Side } from './scoring.js';
import { getPreset, winner as winnerOfScore } from './presets.js';

/**
 * Instant replay is a pure function of the game's own log: nothing is stored beyond the game itself, so it costs a few
 * KB of data at most. It animates teams, not named players (the live tap is per team); it never invents who scored.
 */
export interface ReplayStep {
  /** Milliseconds from the start of the replay. */
  t: number;
  /** How long this step plays. */
  durationMs: number;
  side: Side;
  points: number;
  /** 1 point = driving dunk, 2 points = three-pointer (the pickup convention). */
  shot: 'dunk' | 'three';
  /** Who made the shot, when the captain said so. Never guessed. */
  scorer?: string;
  scoreA: number;
  scoreB: number;
  /** basket: animated. adjust: the score was corrected after a dispute (shown without a shot). */
  kind: 'basket' | 'adjust';
}

export interface Replay {
  mode: GameState['mode'];
  steps: ReplayStep[];
  durationMs: number;
  finalScore: Record<Side, number>;
  winner: Side | null;
  /** True when there is something to animate. */
  available: boolean;
  /** Why there is nothing to animate, when available is false. */
  note?: string;
}

/** About 7 seconds per made shot, whatever the real game took; very long games are sped up to stay watchable. */
export const REPLAY_STEP_MS = 7000;
export const REPLAY_MIN_STEP_MS = 4000;
export const REPLAY_MAX_MS = 90_000;
export const REPLAY_OUTRO_MS = 2500;

export const shotFor = (points: number): 'dunk' | 'three' => (points <= 1 ? 'dunk' : 'three');

export function buildReplay(state: GameState): Replay {
  const finalScore = { ...state.score };
  const base = { mode: state.mode, finalScore, winner: winnerOfScore(finalScore.A, finalScore.B, getPreset(state.presetId)) };
  if (state.status === 'voided') return { ...base, winner: null, steps: [], durationMs: 0, available: false, note: 'This game was voided, so there is no replay.' };

  const shots = state.shots ?? [];
  let a = 0;
  let b = 0;
  for (const sh of shots) {
    if (sh.side === 'A') a += sh.points;
    else b += sh.points;
  }
  const adjust = state.mode === 'live' && shots.length > 0 && (a !== finalScore.A || b !== finalScore.B);
  const count = shots.length + (adjust ? 1 : 0);

  if (shots.length === 0) {
    const note = state.mode === 'quick' ? 'Quick games record only the final score, so there is no replay of baskets.' : 'No baskets were recorded for this game.';
    return { ...base, steps: [], durationMs: 0, available: false, note };
  }

  const stepMs = Math.floor(Math.max(REPLAY_MIN_STEP_MS, Math.min(REPLAY_STEP_MS, (REPLAY_MAX_MS - REPLAY_OUTRO_MS) / count)));
  let ra = 0;
  let rb = 0;
  const steps: ReplayStep[] = shots.map((sh, i) => {
    if (sh.side === 'A') ra += sh.points;
    else rb += sh.points;
    return { t: i * stepMs, durationMs: stepMs, side: sh.side, points: sh.points, shot: shotFor(sh.points), ...(sh.scorer ? { scorer: sh.scorer } : {}), scoreA: ra, scoreB: rb, kind: 'basket' };
  });
  if (adjust) {
    steps.push({ t: shots.length * stepMs, durationMs: 1500, side: finalScore.A >= ra ? 'A' : 'B', points: 0, shot: 'dunk', scoreA: finalScore.A, scoreB: finalScore.B, kind: 'adjust' });
  }
  const last = steps[steps.length - 1]!;
  return { ...base, steps, durationMs: last.t + last.durationMs + REPLAY_OUTRO_MS, available: true };
}
