import { allowedPoints, getPreset, isValidFinalScore, winner, type ScoringPreset } from './presets.js';

export type Side = 'A' | 'B';
export type PlayMode = 'live' | 'quick';
export type GameStatus = 'lobby' | 'active' | 'awaiting_final' | 'disputed' | 'final' | 'voided';

export interface PendingClaim {
  by: Side;
  points: number;
  /** Optional: which seated player on `by` made the shot (user id). Never guessed. */
  scorer?: string;
}

/** One confirmed basket, in order. The replay is built from these. */
export interface GameShot {
  side: Side;
  points: number;
  scorer?: string;
}

export interface LogEntry {
  at: number;
  kind: string;
  side?: Side;
  detail?: string;
}

export interface GameState {
  presetId: string;
  mode: PlayMode;
  status: GameStatus;
  score: Record<Side, number>;
  /** Live mode: one point claim awaiting the other side. */
  pending: PendingClaim | null;
  /** Quick mode: a proposed final score awaiting the other side. */
  proposed: { by: Side; score: Record<Side, number> } | null;
  /** End-of-game confirmations (both needed). */
  finalConfirmed: Record<Side, boolean>;
  dispute: { by: Side; reason: string; from: GameStatus; resolutions: Partial<Record<Side, Record<Side, number>>> } | null;
  /** Once play has started a void needs both captains: the first asks, the other agrees. */
  voidRequest?: { by: Side } | null;
  /** Confirmed baskets in order (Live mode). */
  shots: GameShot[];
  log: LogEntry[];
}

export type GameEvent =
  | { type: 'start'; at?: number }
  | { type: 'claim_point'; side: Side; points: number; scorer?: string; at?: number }
  | { type: 'confirm_point'; side: Side; at?: number }
  | { type: 'dispute'; side: Side; reason: string; at?: number }
  | { type: 'propose_final'; side: Side; score: Record<Side, number>; at?: number }
  | { type: 'confirm_proposed'; side: Side; at?: number }
  | { type: 'confirm_final'; side: Side; at?: number }
  | { type: 'resolve_dispute'; side: Side; score: Record<Side, number>; at?: number }
  | { type: 'void'; side: Side; at?: number };

export class ScoringError extends Error {}

/** `lobby: true` = waiting for every seated player to accept; nothing can be scored until `start`. */
export function newGame(presetId: string, mode: PlayMode, opts: { lobby?: boolean } = {}): GameState {
  getPreset(presetId);
  return {
    presetId,
    mode,
    status: opts.lobby ? 'lobby' : 'active',
    score: { A: 0, B: 0 },
    pending: null,
    proposed: null,
    finalConfirmed: { A: false, B: false },
    dispute: null,
    shots: [],
    log: [],
  };
}

const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');

function log(state: GameState, e: LogEntry): LogEntry[] {
  return [...state.log, e];
}

/** Pure reducer. Throws ScoringError on illegal moves; never mutates input. */
export function applyEvent(state: GameState, ev: GameEvent): GameState {
  const preset: ScoringPreset = getPreset(state.presetId);
  const at = ev.at ?? Date.now();
  const s: GameState = { ...state, score: { ...state.score }, finalConfirmed: { ...state.finalConfirmed } };

  if (state.status === 'final' || state.status === 'voided') {
    throw new ScoringError(`Game is ${state.status}`);
  }

  switch (ev.type) {
    case 'start': {
      if (state.status !== 'lobby') throw new ScoringError('Game already started');
      s.status = 'active';
      s.log = log(state, { at, kind: 'start' });
      return s;
    }
    case 'claim_point': {
      if (state.mode !== 'live') throw new ScoringError('Point claims are Live mode only');
      if (state.status !== 'active') throw new ScoringError(`Cannot score while ${state.status}`);
      if (state.pending) throw new ScoringError('A point is already awaiting confirmation');
      if (!allowedPoints(preset).includes(ev.points)) throw new ScoringError('Point value not allowed by preset');
      s.pending = ev.scorer ? { by: ev.side, points: ev.points, scorer: ev.scorer } : { by: ev.side, points: ev.points };
      s.log = log(state, { at, kind: 'claim', side: ev.side, detail: String(ev.points) });
      return s;
    }
    case 'confirm_point': {
      if (!state.pending) throw new ScoringError('No point to confirm');
      if (state.status !== 'active') throw new ScoringError(`Cannot confirm while ${state.status}`);
      if (ev.side === state.pending.by) throw new ScoringError('The other side must confirm the point');
      s.score[state.pending.by] += state.pending.points;
      s.shots = [...(state.shots ?? []), state.pending.scorer ? { side: state.pending.by, points: state.pending.points, scorer: state.pending.scorer } : { side: state.pending.by, points: state.pending.points }];
      s.pending = null;
      s.log = log(state, { at, kind: 'confirm', side: ev.side });
      if (winner(s.score.A, s.score.B, preset)) s.status = 'awaiting_final';
      return s;
    }
    case 'dispute': {
      if (state.status !== 'active' && state.status !== 'awaiting_final') {
        throw new ScoringError(`Cannot dispute while ${state.status}`);
      }
      s.dispute = { by: ev.side, reason: ev.reason, from: state.status, resolutions: {} };
      s.status = 'disputed';
      s.log = log(state, { at, kind: 'dispute', side: ev.side, detail: ev.reason });
      return s;
    }
    case 'propose_final': {
      if (state.mode !== 'quick') throw new ScoringError('Final proposals are Quick mode only');
      if (state.status !== 'active') throw new ScoringError(`Cannot propose while ${state.status}`);
      if (!isValidFinalScore(ev.score.A, ev.score.B, preset)) throw new ScoringError('Not a valid final score');
      s.proposed = { by: ev.side, score: { ...ev.score } };
      s.log = log(state, { at, kind: 'propose', side: ev.side, detail: `${ev.score.A}-${ev.score.B}` });
      return s;
    }
    case 'confirm_proposed': {
      if (!state.proposed) throw new ScoringError('No proposal to confirm');
      if (state.status !== 'active') throw new ScoringError(`Cannot confirm while ${state.status}`);
      if (ev.side === state.proposed.by) throw new ScoringError('The other side must confirm');
      s.score = { ...state.proposed.score };
      s.proposed = null;
      s.finalConfirmed = { A: true, B: true };
      s.status = 'final';
      s.log = log(state, { at, kind: 'confirm_proposed', side: ev.side });
      return s;
    }
    case 'confirm_final': {
      if (state.status !== 'awaiting_final') throw new ScoringError('Game is not awaiting final confirmation');
      s.finalConfirmed[ev.side] = true;
      s.log = log(state, { at, kind: 'confirm_final', side: ev.side });
      if (s.finalConfirmed.A && s.finalConfirmed.B) s.status = 'final';
      return s;
    }
    case 'resolve_dispute': {
      if (state.status !== 'disputed' || !state.dispute) throw new ScoringError('No dispute to resolve');
      const resolutions = { ...state.dispute.resolutions, [ev.side]: { ...ev.score } };
      const a = resolutions.A;
      const b = resolutions.B;
      s.dispute = { ...state.dispute, resolutions };
      s.log = log(state, { at, kind: 'resolve_vote', side: ev.side, detail: `${ev.score.A}-${ev.score.B}` });
      if (a && b && a.A === b.A && a.B === b.B) {
        s.score = { A: a.A, B: a.B };
        s.pending = null;
        s.proposed = null;
        s.finalConfirmed = { A: false, B: false };
        s.dispute = null;
        s.status = winner(a.A, a.B, preset) ? 'awaiting_final' : 'active';
      }
      return s;
    }
    case 'void': {
      const untouched = state.score.A === 0 && state.score.B === 0 && !state.pending && !state.proposed;
      if (state.status === 'lobby' || untouched || (state.voidRequest && state.voidRequest.by !== ev.side)) {
        s.status = 'voided';
        s.log = log(state, { at, kind: 'void', side: ev.side });
        return s;
      }
      s.voidRequest = { by: ev.side };
      s.log = log(state, { at, kind: 'void_request', side: ev.side });
      return s;
    }
  }
}

/** A game only produces a rating result when final and never while disputed. */
export function ratingWeight(state: GameState): 0 | 1 {
  return state.status === 'final' ? 1 : 0;
}

export function winnerOf(state: GameState): Side | null {
  return state.status === 'final' ? winner(state.score.A, state.score.B, getPreset(state.presetId)) : null;
}

export { other as otherSide };
