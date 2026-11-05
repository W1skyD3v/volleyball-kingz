import type { GameState, PointTag, Side } from './scoring.js';
import { setWins } from './scoring.js';
import type { CourtType } from './presets.js';

/**
 * Instant replay is a pure function of the game's own log: nothing is stored beyond the game itself, so it costs a few
 * KB of data at most. A rally is animated for the team; named players appear only when `who` was recorded (and validated by
 * the server) or, for 6v6, when the rotation names the server. Nothing is guessed.
 */
export interface ReplayStep {
  /** Milliseconds from the start of the replay. */
  t: number;
  /** How long this step plays. */
  durationMs: number;
  set: number;
  /** Side that won the rally. */
  side: Side;
  /** The finishing action to animate. Untagged rallies use the kill script. */
  finish: 'ace' | 'kill' | 'block' | 'error';
  tag?: PointTag;
  who?: string;
  /** Player who served (6v6 rotation only). */
  server?: string;
  /** Serving side when the rally started. */
  serving: Side;
  sideOut: boolean;
  /** Score within the set after this rally. */
  scoreA: number;
  scoreB: number;
  /** Sets won by each side before this rally's set ends (including this rally's set when it ends here). */
  setsA: number;
  setsB: number;
  /** True when this rally ended the set. */
  setEnd: boolean;
  /** True when the sides changed ends right after this rally (beach side switch or new set). */
  switched: boolean;
}

export interface Replay {
  mode: GameState['mode'];
  steps: ReplayStep[];
  durationMs: number;
  /** Set scores: completed sets, plus the current one when the match is not decided. */
  setScores: { A: number; B: number }[];
  winner: Side | null;
  /** True when there is something to animate. */
  available: boolean;
  /** Why there is nothing to animate, when available is false. */
  note?: string;
}

/** About 7 seconds per rally won, whatever the real game took; very long matches are sped up to stay watchable. */
export const REPLAY_STEP_MS = 7000;
export const REPLAY_MIN_STEP_MS = 3000;
export const REPLAY_MAX_MS = 120_000;
export const REPLAY_OUTRO_MS = 2500;

export type StageKind = 'sand' | 'gym';
/** Beach courts get the sand stage; everything else the indoor gym. */
export const stageFor = (courtType: CourtType | null | undefined): StageKind => (courtType === 'beach' ? 'sand' : 'gym');

export const finishFor = (tag: PointTag | undefined): ReplayStep['finish'] => tag ?? 'kill';

export function buildReplay(state: GameState): Replay {
  const wins = setWins(state.sets);
  const winner: Side | null = state.status === 'final' && wins.A !== wins.B ? (wins.A > wins.B ? 'A' : 'B') : null;
  const setScores = state.status === 'final' || state.status === 'awaiting_final' ? [...state.sets] : [...state.sets, { ...state.score }];
  const base = { mode: state.mode, winner, setScores };
  const none = (note: string): Replay => ({ ...base, steps: [], durationMs: 0, available: false, note });

  if (state.status === 'voided') return none('This game was voided, so there is no replay.');
  if (state.corrected) return none('The score was corrected after a dispute, so the rallies can no longer be replayed.');
  const points = state.points ?? [];
  if (points.length === 0) {
    return none(state.mode === 'quick' ? 'Quick games record only the set scores, so there is no replay of rallies.' : 'No rallies were recorded for this game.');
  }
  // The rally list must add up to the recorded scores, otherwise we would be inventing a game.
  const perSet = new Map<number, { A: number; B: number }>();
  for (const p of points) {
    const c = perSet.get(p.set) ?? { A: 0, B: 0 };
    c[p.side] += 1;
    perSet.set(p.set, c);
  }
  const expected = setScores;
  const consistent = expected.every((sc, i) => (perSet.get(i + 1)?.A ?? 0) === sc.A && (perSet.get(i + 1)?.B ?? 0) === sc.B);
  if (!consistent) return none('The rally list does not match the score, so there is no replay.');

  const stepMs = Math.floor(Math.max(REPLAY_MIN_STEP_MS, Math.min(REPLAY_STEP_MS, (REPLAY_MAX_MS - REPLAY_OUTRO_MS) / points.length)));
  const running = new Map<number, { A: number; B: number }>();
  let setsA = 0;
  let setsB = 0;
  const steps: ReplayStep[] = points.map((p, i) => {
    const c = running.get(p.set) ?? { A: 0, B: 0 };
    c[p.side] += 1;
    running.set(p.set, c);
    const final = state.sets[p.set - 1];
    const setEnd = !!final && c.A === final.A && c.B === final.B && (perSet.get(p.set)!.A === c.A && perSet.get(p.set)!.B === c.B);
    if (setEnd) {
      if (final!.A > final!.B) setsA++;
      else setsB++;
    }
    const next = points[i + 1];
    // The side serving when the rally started: the winner served if it was not a side-out.
    const serving: Side = p.sideOut ? (p.side === 'A' ? 'B' : 'A') : p.side;
    const switchedEvent = state.events.some((e) => e.k === 'side_switch' && e.set === p.set && e.total === c.A + c.B);
    return {
      t: i * stepMs,
      durationMs: stepMs,
      set: p.set,
      side: p.side,
      finish: finishFor(p.tag),
      ...(p.tag ? { tag: p.tag } : {}),
      ...(p.who !== undefined ? { who: p.who } : {}),
      ...(p.server !== undefined ? { server: p.server } : {}),
      serving,
      sideOut: p.sideOut,
      scoreA: c.A,
      scoreB: c.B,
      setsA,
      setsB,
      setEnd,
      switched: setEnd ? !!next : switchedEvent,
    };
  });
  const last = steps[steps.length - 1]!;
  return { ...base, steps, durationMs: last.t + last.durationMs + REPLAY_OUTRO_MS, available: true };
}
