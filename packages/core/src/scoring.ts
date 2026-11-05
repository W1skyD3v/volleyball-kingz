import {
  SWITCH_EVERY,
  SWITCH_EVERY_DECIDING,
  TIMEOUTS_PER_SET,
  getPreset,
  isDecidingSet,
  isOpenScore,
  isValidSetFinal,
  setRuleFor,
  setWinner,
  type SetRule,
  setsToWin,
  switchesDuringSet,
  type ScoringPreset,
} from './presets.js';

export type Side = 'A' | 'B';
export type PlayMode = 'live' | 'quick';
/** Quick (confirm the final set score at the end) is the default entry mode: a set is 30-50 rallies. Live stays optional. */
export const DEFAULT_PLAY_MODE: PlayMode = 'quick';
export type GameStatus = 'lobby' | 'active' | 'awaiting_final' | 'disputed' | 'final' | 'voided';

/** Optional per-point tag. `ace` needs the winner to have been serving. */
export const POINT_TAGS = ['ace', 'kill', 'block', 'error'] as const;
export type PointTag = (typeof POINT_TAGS)[number];

export interface PendingClaim {
  by: Side;
  tag?: PointTag;
  /** Optional: the roster player the tag is about (winning side; for `error`, the losing side). Never guessed. */
  who?: string;
}

/** One confirmed rally, in order. The replay is built from these. */
export interface PointRecord {
  set: number;
  side: Side;
  tag?: PointTag;
  who?: string;
  /** Player who served this rally. Tracked for 6v6 only (the rotation); absent for 2v2 and 4v4. */
  server?: string;
  /** The point winner was receiving: serve changes sides and that side rotates. */
  sideOut: boolean;
}

export interface SetScore {
  A: number;
  B: number;
}

export type MatchEvent =
  | { k: 'side_out'; set: number; side: Side }
  | { k: 'side_switch'; set: number; total: number }
  | { k: 'set_end'; set: number; A: number; B: number; winner: Side }
  | { k: 'timeout'; set: number; side: Side }
  | { k: 'time_up'; set: number; A: number; B: number }
  | { k: 'substitution'; set: number; side: Side; out: string; in: string };

export interface LogEntry {
  at: number;
  kind: string;
  side?: Side;
  detail?: string;
}

export type Lineup = Record<Side, string[]>;

export interface GameState {
  presetId: string;
  mode: PlayMode;
  status: GameStatus;
  /** Players per side (2, 4 or 6). */
  tier: number;
  roster: Lineup;
  /** Serving order at the start of every set. */
  startOrder: Lineup;
  /** Current serving order: index 0 is the server. Only 6v6 rotates it (2v2 and 4v4 keep it fixed). */
  rotation: Lineup;
  /** Team holding serve (tracked for every format: it decides side-outs and whether an ace is possible). */
  serving: Side;
  /** Who served first in set 1. First serve alternates every set. */
  firstServer: Side;
  ends: Record<Side, 'L' | 'R'>;
  /** 1-based number of the set being played (or the last set, once the match is decided). */
  setNo: number;
  /** Points in the current set (the last set's final score once the match is decided). */
  score: Record<Side, number>;
  /** Completed sets, in order. */
  sets: SetScore[];
  timeouts: Record<Side, number>;
  /** Server time (ms) the game started; the time cap counts from here. */
  startedAt: number | null;
  /** The time cap was called (see `time_up`): a tied score now plays to the next point. */
  timeUp: boolean;
  /** Live mode: one point claim awaiting the other side. */
  pending: PendingClaim | null;
  /** Quick mode: a proposed result (every set) awaiting the other side. */
  proposed: { by: Side; sets: SetScore[] } | null;
  /** End-of-match confirmations (both needed). */
  finalConfirmed: Record<Side, boolean>;
  dispute: { by: Side; reason: string; from: GameStatus; resolutions: Partial<Record<Side, SetScore[]>> } | null;
  /** Once play has started a void needs both captains: the first asks, the other agrees. */
  voidRequest?: { by: Side } | null;
  /** Confirmed rallies in order (Live mode). */
  points: PointRecord[];
  events: MatchEvent[];
  /** True when a dispute settlement replaced the score: rotation and the rally list can no longer be trusted for a replay. */
  corrected: boolean;
  log: LogEntry[];
}

export type GameEvent =
  | { type: 'start'; at?: number }
  | { type: 'claim_point'; side: Side; tag?: string; who?: string; at?: number }
  | { type: 'confirm_point'; side: Side; at?: number }
  | { type: 'dispute'; side: Side; reason: string; at?: number }
  | { type: 'propose_final'; side: Side; sets: SetScore[]; at?: number }
  | { type: 'confirm_proposed'; side: Side; at?: number }
  | { type: 'confirm_final'; side: Side; at?: number }
  | { type: 'resolve_dispute'; side: Side; sets: SetScore[]; at?: number }
  | { type: 'timeout'; side: Side; at?: number }
  | { type: 'time_up'; side: Side; at?: number }
  | { type: 'substitution'; side: Side; out: string; in: string; at?: number }
  | { type: 'void'; side: Side; at?: number };

export class ScoringError extends Error {}

/** No real set gets near this; it keeps stored scores small and the SQL and TypeScript integer checks identical. */
export const MAX_SET_SCORE = 99;

export interface NewGameOptions {
  /** `lobby: true` = waiting for every seated player to accept; nothing can be scored until `start`. */
  lobby?: boolean;
  /** Serving order per side: index 0 serves first. Defaults to placeholder players, which is only fit for tests and the demo. */
  roster?: Lineup;
  firstServer?: Side;
  /** Server time (ms) the game started. Defaults to now when the game is not a lobby. */
  startedAt?: number;
}

const placeholder = (side: Side, n: number): string[] => Array.from({ length: n }, (_, i) => `${side}${i + 1}`);

export function newGame(presetId: string, mode: PlayMode, opts: NewGameOptions = {}): GameState {
  getPreset(presetId);
  const roster: Lineup = opts.roster ?? { A: placeholder('A', 2), B: placeholder('B', 2) };
  const first = opts.firstServer ?? 'A';
  return {
    presetId,
    mode,
    status: opts.lobby ? 'lobby' : 'active',
    tier: roster.A.length,
    roster: { A: [...roster.A], B: [...roster.B] },
    startOrder: { A: [...roster.A], B: [...roster.B] },
    rotation: { A: [...roster.A], B: [...roster.B] },
    serving: first,
    firstServer: first,
    ends: { A: 'L', B: 'R' },
    setNo: 1,
    score: { A: 0, B: 0 },
    sets: [],
    timeouts: { A: 0, B: 0 },
    startedAt: opts.lobby ? null : (opts.startedAt ?? Date.now()),
    timeUp: false,
    pending: null,
    proposed: null,
    finalConfirmed: { A: false, B: false },
    dispute: null,
    points: [],
    events: [],
    corrected: false,
    log: [],
  };
}

export const otherSide = (s: Side): Side => (s === 'A' ? 'B' : 'A');
const other = otherSide;

/** Rotate a serving order by one: the next player in line becomes the server. */
export const rotate = (order: readonly string[]): string[] => (order.length === 0 ? [] : [...order.slice(1), order[0]!]);

export const currentServer = (s: GameState): string => s.rotation[s.serving][0]!;

/** Sets won by each side. Every stored set is complete, so the higher score won it. */
export function setWins(sets: readonly SetScore[]): Record<Side, number> {
  let A = 0;
  let B = 0;
  for (const s of sets) if (s.A > s.B) A++;
  else B++;
  return { A, B };
}

export interface SetAnalysis {
  completed: SetScore[];
  /** The set in progress, or null when the match is decided. */
  current: SetScore | null;
  wins: Record<Side, number>;
  decided: boolean;
}

/** Winner of a set at (a, b): the regular rule, or (time cap passed, scores differ) the leader. */
export function setOutcome(rule: SetRule, a: number, b: number, timeCapped: boolean): { winner: Side; timed: boolean } | null {
  const w = setWinner(a, b, rule);
  if (w) return { winner: w, timed: false };
  if (timeCapped && a !== b && isOpenScore(a, b, rule)) return { winner: a > b ? 'A' : 'B', timed: true };
  return null;
}

/** True once the preset's time cap (counted from kick-off, server time) has passed. */
export function timeExpired(state: Pick<GameState, 'startedAt'>, preset: ScoringPreset, at: number): boolean {
  return preset.timeCapMin !== null && state.startedAt !== null && at - state.startedAt >= preset.timeCapMin * 60_000;
}

/**
 * Validates a list of set scores against the preset. Every set but (optionally) the last must be a reachable final under that set's
 * rule, and no set may follow a decided match. With `allowOpen` the last set may be in progress. `expired` = the preset's time cap has
 * passed, so a set that is not won by the regular rule is decided for the leader (a tie stays open). Throws ScoringError.
 */
export function analyzeSets(p: ScoringPreset, sets: readonly SetScore[], allowOpen: boolean, expired = false): SetAnalysis {
  const need = setsToWin(p);
  const timeCapped = p.timeCapMin !== null && expired;
  const completed: SetScore[] = [];
  const wins = { A: 0, B: 0 };
  let current: SetScore | null = null;
  for (let i = 0; i < sets.length; i++) {
    if (wins.A >= need || wins.B >= need) throw new ScoringError('Sets after the match was decided');
    if (i >= p.bestOf) throw new ScoringError('Too many sets');
    const s = sets[i]!;
    if (!Number.isInteger(s.A) || !Number.isInteger(s.B) || s.A < 0 || s.B < 0 || s.A > MAX_SET_SCORE || s.B > MAX_SET_SCORE) throw new ScoringError('Bad set score');
    const rule = setRuleFor(p, i + 1);
    const o = setOutcome(rule, s.A, s.B, timeCapped);
    if (o) {
      if (!o.timed && !isValidSetFinal(s.A, s.B, rule)) throw new ScoringError('Not a valid final set score');
      completed.push({ A: s.A, B: s.B });
      wins[o.winner]++;
    } else if (allowOpen && i === sets.length - 1 && isOpenScore(s.A, s.B, rule)) {
      current = { A: s.A, B: s.B };
    } else {
      throw new ScoringError('Set is not finished');
    }
  }
  const decided = wins.A >= need || wins.B >= need;
  if (!decided && current === null) {
    if (!allowOpen) throw new ScoringError('Match is not decided');
    current = { A: 0, B: 0 };
  }
  return { completed, current, wins, decided };
}

function log(state: GameState, e: LogEntry): LogEntry[] {
  return [...state.log, e];
}

const sameSets = (x: readonly SetScore[], y: readonly SetScore[]): boolean => x.length === y.length && x.every((s, i) => s.A === y[i]!.A && s.B === y[i]!.B);

/** Pure reducer. Throws ScoringError on illegal moves; never mutates input. */
export function applyEvent(state: GameState, ev: GameEvent): GameState {
  const preset: ScoringPreset = getPreset(state.presetId);
  const at = ev.at ?? Date.now();
  const s: GameState = {
    ...state,
    score: { ...state.score },
    finalConfirmed: { ...state.finalConfirmed },
    rotation: { A: [...state.rotation.A], B: [...state.rotation.B] },
    ends: { ...state.ends },
    timeouts: { ...state.timeouts },
  };

  if (state.status === 'final' || state.status === 'voided') {
    throw new ScoringError(`Game is ${state.status}`);
  }

  switch (ev.type) {
    case 'start': {
      if (state.status !== 'lobby') throw new ScoringError('Game already started');
      s.status = 'active';
      s.startedAt = at;
      s.log = log(state, { at, kind: 'start' });
      return s;
    }
    case 'claim_point': {
      if (state.mode !== 'live') throw new ScoringError('Point claims are Live mode only');
      if (state.status !== 'active') throw new ScoringError(`Cannot score while ${state.status}`);
      if (state.pending) throw new ScoringError('A point is already awaiting confirmation');
      if (!state.timeUp && timeExpired(state, preset, at)) throw new ScoringError('time_is_up');
      let tag: PointTag | undefined;
      if (ev.tag !== undefined) {
        if (!(POINT_TAGS as readonly string[]).includes(ev.tag)) throw new ScoringError('Unknown point tag');
        tag = ev.tag as PointTag;
        if (tag === 'ace' && ev.side !== state.serving) throw new ScoringError('An ace needs the serving side to win the point');
      }
      if (ev.who !== undefined) {
        // The player a tag is about: on the winning side, except for an error, which belongs to the losing side.
        const whoSide = tag === 'error' ? other(ev.side) : ev.side;
        if (!state.roster[whoSide].includes(ev.who)) throw new ScoringError('That player is not on the right side');
      }
      s.pending = { by: ev.side, ...(tag ? { tag } : {}), ...(ev.who !== undefined ? { who: ev.who } : {}) };
      s.log = log(state, { at, kind: 'claim', side: ev.side, detail: tag ?? '' });
      return s;
    }
    case 'confirm_point': {
      if (!state.pending) throw new ScoringError('No point to confirm');
      if (state.status !== 'active') throw new ScoringError(`Cannot confirm while ${state.status}`);
      if (ev.side === state.pending.by) throw new ScoringError('The other side must confirm the point');
      const x = state.pending.by;
      const sideOut = x !== state.serving;
      s.points = [
        ...state.points,
        { set: state.setNo, side: x, ...(state.pending.tag ? { tag: state.pending.tag } : {}), ...(state.pending.who !== undefined ? { who: state.pending.who } : {}), ...(state.tier === 6 ? { server: currentServer(state) } : {}), sideOut },
      ];
      s.score[x] += 1;
      s.pending = null;
      s.events = [...state.events];
      if (sideOut) {
        s.serving = x;
        if (state.tier === 6) s.rotation[x] = rotate(state.rotation[x]);
        s.events.push({ k: 'side_out', set: state.setNo, side: x });
      }
      s.log = log(state, { at, kind: 'confirm', side: ev.side });
      const rule = setRuleFor(preset, state.setNo);
      const out = setOutcome(rule, s.score.A, s.score.B, state.timeUp);
      const won = out?.winner ?? null;
      if (won) {
        s.sets = [...state.sets, { A: s.score.A, B: s.score.B }];
        s.events.push({ k: 'set_end', set: state.setNo, A: s.score.A, B: s.score.B, winner: won });
        const wins = setWins(s.sets);
        if (wins.A >= setsToWin(preset) || wins.B >= setsToWin(preset)) {
          s.status = 'awaiting_final';
        } else {
          s.setNo = state.setNo + 1;
          s.score = { A: 0, B: 0 };
          s.rotation = { A: [...state.startOrder.A], B: [...state.startOrder.B] };
          s.serving = s.setNo % 2 === 1 ? state.firstServer : other(state.firstServer);
          s.ends = { A: state.ends.A === 'L' ? 'R' : 'L', B: state.ends.B === 'L' ? 'R' : 'L' };
          s.timeouts = { A: 0, B: 0 };
        }
      } else if (switchesDuringSet(state.tier)) {
        const total = s.score.A + s.score.B;
        const every = isDecidingSet(preset, state.setNo) ? SWITCH_EVERY_DECIDING : SWITCH_EVERY;
        if (total % every === 0) {
          s.ends = { A: state.ends.A === 'L' ? 'R' : 'L', B: state.ends.B === 'L' ? 'R' : 'L' };
          s.events.push({ k: 'side_switch', set: state.setNo, total });
        }
      }
      return s;
    }
    case 'timeout': {
      if (state.mode !== 'live') throw new ScoringError('Timeouts are Live mode only');
      if (state.status !== 'active') throw new ScoringError(`Cannot call a timeout while ${state.status}`);
      if (state.pending) throw new ScoringError('A point is awaiting confirmation');
      if (state.timeouts[ev.side] >= TIMEOUTS_PER_SET) throw new ScoringError('No timeouts left this set');
      s.timeouts[ev.side] += 1;
      s.events = [...state.events, { k: 'timeout', set: state.setNo, side: ev.side }];
      s.log = log(state, { at, kind: 'timeout', side: ev.side });
      return s;
    }
    case 'time_up': {
      if (state.mode !== 'live') throw new ScoringError('time_up is Live mode only (Quick mode checks the clock when the score is proposed)');
      if (state.status !== 'active') throw new ScoringError(`Cannot call time while ${state.status}`);
      if (state.pending) throw new ScoringError('A point is awaiting confirmation');
      if (preset.timeCapMin === null) throw new ScoringError('This preset has no time cap');
      if (state.timeUp) throw new ScoringError('Time is already called');
      if (!timeExpired(state, preset, at)) throw new ScoringError('The time cap has not passed');
      s.timeUp = true;
      s.events = [...state.events, { k: 'time_up', set: state.setNo, A: state.score.A, B: state.score.B }];
      s.log = log(state, { at, kind: 'time_up', side: ev.side });
      if (state.score.A !== state.score.B) {
        const winner: Side = state.score.A > state.score.B ? 'A' : 'B';
        s.sets = [...state.sets, { A: state.score.A, B: state.score.B }];
        s.events.push({ k: 'set_end', set: state.setNo, A: state.score.A, B: state.score.B, winner });
        s.status = 'awaiting_final';
      }
      return s;
    }
    case 'substitution': {
      if (state.tier !== 6) throw new ScoringError('Substitutions are indoor (6v6) only');
      if (state.status !== 'active') throw new ScoringError(`Cannot substitute while ${state.status}`);
      if (state.pending) throw new ScoringError('A point is awaiting confirmation');
      const bench = state.roster[ev.side].filter((p) => !state.rotation[ev.side].includes(p));
      if (bench.length === 0) throw new ScoringError('no_bench');
      if (!bench.includes(ev.in) || !state.rotation[ev.side].includes(ev.out)) throw new ScoringError('Bad substitution');
      s.rotation[ev.side] = state.rotation[ev.side].map((p) => (p === ev.out ? ev.in : p));
      s.events = [...state.events, { k: 'substitution', set: state.setNo, side: ev.side, out: ev.out, in: ev.in }];
      s.log = log(state, { at, kind: 'substitution', side: ev.side });
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
      analyzeSets(preset, ev.sets, false, timeExpired(state, preset, at));
      s.proposed = { by: ev.side, sets: ev.sets.map((x) => ({ A: x.A, B: x.B })) };
      s.log = log(state, { at, kind: 'propose', side: ev.side, detail: ev.sets.map((x) => `${x.A}-${x.B}`).join(' ') });
      return s;
    }
    case 'confirm_proposed': {
      if (!state.proposed) throw new ScoringError('No proposal to confirm');
      if (state.status !== 'active') throw new ScoringError(`Cannot confirm while ${state.status}`);
      if (ev.side === state.proposed.by) throw new ScoringError('The other side must confirm');
      s.sets = state.proposed.sets.map((x) => ({ ...x }));
      s.setNo = s.sets.length;
      s.score = { ...s.sets[s.sets.length - 1]! };
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
      analyzeSets(preset, ev.sets, true, timeExpired(state, preset, at)); // reject nonsense at submission time
      const resolutions = { ...state.dispute.resolutions, [ev.side]: ev.sets.map((x) => ({ A: x.A, B: x.B })) };
      s.dispute = { ...state.dispute, resolutions };
      s.log = log(state, { at, kind: 'resolve_vote', side: ev.side, detail: ev.sets.map((x) => `${x.A}-${x.B}`).join(' ') });
      const ra = resolutions.A;
      const rb = resolutions.B;
      if (ra && rb && sameSets(ra, rb)) {
        const res = analyzeSets(preset, ra, true, timeExpired(state, preset, at));
        s.sets = res.completed;
        s.score = res.current ? { ...res.current } : { ...res.completed[res.completed.length - 1]! };
        s.setNo = res.decided ? res.completed.length : res.completed.length + 1;
        s.pending = null;
        s.proposed = null;
        s.finalConfirmed = { A: false, B: false };
        s.dispute = null;
        s.corrected = true;
        s.timeUp = !res.decided && timeExpired(state, preset, at);
        s.timeouts = { A: 0, B: 0 };
        s.status = res.decided ? 'awaiting_final' : 'active';
      }
      return s;
    }
    case 'void': {
      const untouched = state.sets.length === 0 && state.score.A === 0 && state.score.B === 0 && !state.pending && !state.proposed;
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

/** The side that won the match (more sets), once it is final. */
export function winnerOf(state: GameState): Side | null {
  if (state.status !== 'final') return null;
  const w = setWins(state.sets);
  return w.A === w.B ? null : w.A > w.B ? 'A' : 'B';
}
