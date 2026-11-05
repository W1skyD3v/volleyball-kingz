import type { AvatarConfig } from '@vk/avatar';
import type {
  Loadout, Slot, CourtType, GameEvent, GameState, Lane, LatLng, PlayMode, ReportInput, Side, Tier, TierUsageEvent, Fix, EloHistoryPoint, PlayerStats,
} from '@vk/core';

export interface MyProfile {
  id: string;
  displayName: string;
  isMinor: boolean;
  casualEloOptIn: boolean;
  avatar: AvatarConfig;
  goldEarned: number;
  goldBought: number; // always 0 in the draft
}

/** Cosmetics you own and wear plus your spendable earned Gold. */
export interface Closet {
  gold: number;
  owned: string[];
  loadout: Loadout;
}

export interface CourtView {
  id: string;
  name: string;
  lat: number;
  lng: number;
  courtType: CourtType;
  typeSource: 'geometry' | 'bounds' | 'tag' | 'none';
  headcount: number;
  fullConfirmations: number;
  /** OSM pitches merged into this site. */
  memberCount?: number;
  distanceM?: number;
}

export interface RunView {
  id: string;
  courtId: string;
  courtName: string;
  hostId: string;
  hostName: string;
  startsAt: number;
  tier: Tier;
  lane: Lane;
  presetId: string;
  note?: string;
  members: { id: string; name: string }[];
  status: 'open' | 'cancelled';
  mine: boolean;
  joined: boolean;
}

export interface CheckInResult {
  ok: boolean;
  reason: 'ok' | 'too_far' | 'bad_fix' | 'no_permission';
  distanceM?: number;
}

export interface NewRun {
  courtId: string;
  startsAt: number;
  tier: Tier;
  lane: Lane;
  presetId: string;
  note?: string;
}

export interface NewGame {
  courtId: string;
  lane: Lane;
  tier: Tier;
  presetId: string;
  mode: PlayMode;
}

export interface GamePlayer {
  id: string;
  name: string;
  /** Has this player accepted the game? Everyone must before it starts. */
  accepted?: boolean;
}

export interface GameRecord {
  id: string;
  courtId: string;
  lane: Lane;
  tier: Tier;
  mode: PlayMode;
  state: GameState;
  players: { A: GamePlayer[]; B: GamePlayer[] };
  /** Which side the signed-in user captains. null = demo pass-the-phone (controls both sides). */
  mySide: Side | null;
  /** Result of rating/gold once finalized. */
  outcome?: {
    ratingLine: string; // one-line reason shown to the player
    goldAwarded: number;
    unrated: boolean;
    /** Server has not processed the result yet. */
    pending?: boolean;
  };
  feedback?: { gameRating: number };
}

export interface FriendView {
  userId: string;
  name: string;
  relation: 'friend' | 'incoming' | 'outgoing';
  requestId: string;
  /** Where an accepted friend is checked in right now (shown to friends only). */
  courtName?: string;
  courtId?: string;
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  rating: number;
  range: number;
  games: number;
  deleted: boolean;
}

export interface StatRow {
  tier: Tier;
  lane: Lane;
  games: number;
  wins: number;
}

export interface RatingView {
  tier: Tier;
  label: string; // "1200 +/- 200 (provisional)"
  stats: PlayerStats;
}

export interface MyRatings {
  ranked: RatingView[];
  casualElo: { tier: Tier; rating: number }[];
  privateHistory: EloHistoryPoint[]; // last 10
  /** Display-only blend of your tier ratings; null until one tier has 10 games. Never used for matchmaking. */
  overall: { rating: number; tiers: number } | null;
}

/** Everything the UI needs from a server. Memory (demo) and Supabase adapters implement this. */
export interface Backend {
  /** True when the backend needs a real login (Supabase). The demo backend does not. */
  readonly supportsAuth: boolean;
  /** True when a game can be started solo against placeholder players (demo only). Real games start from a run. */
  readonly soloDemoGames: boolean;
  isSignedIn(): Promise<boolean>;
  signInWithEmail(email: string): Promise<void>;
  verifyEmailCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;

  getProfile(): Promise<MyProfile | null>;
  createProfile(displayName: string, birthDate: Date): Promise<MyProfile>;
  setCasualEloOptIn(on: boolean): Promise<void>;
  setAvatar(a: AvatarConfig): Promise<void>;

  /** First call grants the starter pack. Buying rejects with unknown_item | premium_only | already_owned | not_enough_gold. */
  getCloset(): Promise<Closet>;
  buyItem(id: string): Promise<Closet>;
  /** Rejects with unknown_item | not_owned. */
  equipItem(id: string): Promise<Closet>;
  /** Only headwear and accessory can come off (otherwise cannot_empty). */
  unequipSlot(slot: Slot): Promise<Closet>;

  listCourts(near?: LatLng): Promise<CourtView[]>;
  checkIn(courtId: string, fix: Fix): Promise<CheckInResult>;
  checkOut(): Promise<void>;
  confirmFullCourt(courtId: string): Promise<void>;
  myCheckInCourtId(): Promise<string | null>;

  listRuns(): Promise<RunView[]>;
  createRun(r: NewRun): Promise<void>;
  joinRun(id: string): Promise<void>;
  leaveRun(id: string): Promise<void>;
  cancelRun(id: string): Promise<void>;

  report(r: ReportInput): Promise<void>;
  block(userId: string): Promise<void>;

  myFriendCode(): Promise<string>;
  listFriends(): Promise<FriendView[]>;
  /** Add by code only (no name search). Rejects with friend_not_found for unknown codes, yourself, or anyone you cannot see. */
  sendFriendRequest(code: string): Promise<void>;
  respondFriendRequest(requestId: string, accept: boolean): Promise<void>;
  removeFriend(userId: string): Promise<void>;
  /** Host of a private run invites an accepted friend. */
  inviteToRun(runId: string, userId: string): Promise<void>;

  leaderboard(tier: Tier): Promise<LeaderboardRow[]>;
  /** Your history. Private-lane games appear only here, never to others. */
  myStats(): Promise<StatRow[]>;

  /** Demo only (see soloDemoGames). */
  createGame(g: NewGame): Promise<GameRecord>;
  /** Start a game from a run's members: host first on side A, then alternating. Needs exactly 2 x tier members. */
  startGameFromRun(runId: string, mode: PlayMode): Promise<GameRecord>;
  getGame(id: string): Promise<GameRecord>;
  /** Every seated player must accept before a game starts. */
  acceptGame(id: string): Promise<GameRecord>;
  declineGame(id: string): Promise<GameRecord>;
  /** The only way to change a game. The server decides legality; side comes from the caller's identity in real backends. */
  sendEvent(id: string, ev: GameEvent): Promise<GameRecord>;
  subscribeGame?(id: string, onChange: (g: GameRecord) => void): () => void;
  submitFeedback(id: string, gameRating: number): Promise<void>;
  ratePlayer(gameId: string, userId: string, stars: number): Promise<void>;

  getRatings(): Promise<MyRatings>;
  tierUsage(): Promise<TierUsageEvent[]>;
  /** Removes everything tied to your account. keepName keeps your display name and ranked stats on leaderboards (default). */
  deleteAccount(keepName?: boolean): Promise<void>;
}

export type { GameState };
