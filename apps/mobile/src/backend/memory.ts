import { defaultAvatarConfig, type AvatarConfig } from '@vk/avatar';
import {
  OPTIONAL_SLOTS, checkBuy, checkEquip, defaultLoadout, starterItems, type Loadout, ageBand, applyEvent, canPlayTierOnCourt, evaluateCheckIn, fullCourtConfirmed, getPreset, goldForGame, haversineMeters,
  headcountByCourt, overallRating, priorFor, lanePolicy, lastTenHistory, newGame, newSkill, rateGame, ratingLabel, repeatWeight, eloUpdate,
  tierUsageEvent, winnerOf, CHECKIN_TTL_MIN, type CheckIn, type EloHistoryPoint, type Fix, type GameEvent, type LatLng, type PlayerStats,
  type ReportInput, type SkillRating, type Tier, type TierUsageEvent,
} from '@vk/core';
import type {
  Backend, CheckInResult, Closet, CourtView, FriendView, GamePlayer, GameRecord, LeaderboardRow, MyProfile, MyRatings, NewGame, NewRun, RunView, StatRow,
} from './types';

interface DemoCourt extends CourtView {
  access: 'public';
}

/** Demo courts (names invented; positions are real LA spots). Real data comes from the Supabase courts table. */
const DEMO_COURTS: DemoCourt[] = [
  { id: 'c1', name: 'Pershing Square (demo)', lat: 34.0488, lng: -118.2518, courtType: 'full', typeSource: 'geometry', headcount: 0, fitConfirmations: 1, access: 'public' },
  { id: 'c2', name: 'Venice Beach Courts (demo)', lat: 33.9867, lng: -118.4731, courtType: 'full', typeSource: 'tag', headcount: 0, fitConfirmations: 0, access: 'public' },
  { id: 'c3', name: 'Echo Park half court (demo)', lat: 34.0782, lng: -118.2606, courtType: 'half', typeSource: 'tag', headcount: 0, fitConfirmations: 0, access: 'public' },
  { id: 'c4', name: 'Unmapped park court (demo)', lat: 34.0195, lng: -118.4912, courtType: 'unknown', typeSource: 'none', headcount: 0, fitConfirmations: 0, access: 'public' },
];

const OTHERS = [
  { id: 'u-ana', name: 'Ana', isMinor: false },
  { id: 'u-bo', name: 'Bo', isMinor: false },
  { id: 'u-cy', name: 'Cy', isMinor: false },
  { id: 'u-dee', name: 'Dee', isMinor: false },
  { id: 'u-teen', name: 'Teen Hooper', isMinor: true },
];

interface RatingBook {
  ranked: Partial<Record<Tier, SkillRating>>;
  stats: Partial<Record<Tier, PlayerStats & { opponents: Set<string> }>>;
  casualElo: Partial<Record<Tier, { rating: number; games: number }>>;
  privateElo: { rating: number; games: number };
  privateHistory: EloHistoryPoint[];
}

let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

export interface MemoryOptions {
  now?: () => number;
}

/** In-memory demo backend. Everything the draft app does works against this with no server. */
export function createMemoryBackend(opts: MemoryOptions = {}): Backend {
  const now = opts.now ?? (() => Date.now());
  let me: MyProfile | null = null;
  const courts = DEMO_COURTS.map((c) => ({ ...c }));
  const checkIns: CheckIn[] = [
    { userId: 'u-ana', courtId: 'c1', at: now() - 10 * 60_000, isMinor: false },
    { userId: 'u-bo', courtId: 'c1', at: now() - 20 * 60_000, isMinor: false },
    { userId: 'u-teen', courtId: 'c1', at: now() - 5 * 60_000, isMinor: true },
    { userId: 'u-cy', courtId: 'c2', at: now() - 30 * 60_000, isMinor: false },
  ];
  const runs: { id: string; courtId: string; hostId: string; startsAt: number; tier: Tier; lane: NewRun['lane']; presetId: string; note?: string; members: string[]; invited: string[]; status: 'open' | 'cancelled' }[] = [
    { id: 'r1', courtId: 'c1', hostId: 'u-ana', startsAt: now() + 3_600_000, tier: 3, lane: 'casual', presetId: '11-1s2s-w1', note: 'Bring a dark and a light shirt', members: ['u-ana', 'u-bo'], invited: [], status: 'open' },
    { id: 'r2', courtId: 'c1', hostId: 'u-teen', startsAt: now() + 7_200_000, tier: 2, lane: 'casual', presetId: '7-1s-w1', members: ['u-teen'], invited: [], status: 'open' },
  ];
  const blocked = new Set<string>();
  const reports: ReportInput[] = [];
  const games = new Map<string, GameRecord>();
  const usage: TierUsageEvent[] = [];
  const book: RatingBook = { ranked: {}, stats: {}, casualElo: {}, privateElo: { rating: 1200, games: 0 }, privateHistory: [] };
  let goldToday = 0;
  const owned = new Set<string>();
  let loadout: Loadout = {};
  const friends: { id: string; name: string; relation: FriendView['relation']; requestId: string }[] = [
    { id: 'u-ana', name: 'Ana', relation: 'friend', requestId: 'fr-0' },
    { id: 'u-cy', name: 'Cy', relation: 'incoming', requestId: 'fr-1' },
  ];
  const CODES: Record<string, { id: string; name: string }> = { BOBOBO22: { id: 'u-bo', name: 'Bo' }, DEEDEE44: { id: 'u-dee', name: 'Dee' }, TEEN0001: { id: 'u-teen', name: 'Teen Hooper' } };

  const name = (id: string) => (id === me?.id ? me.displayName : OTHERS.find((o) => o.id === id)?.name ?? 'Player');
  const viewer = () => (me?.isMinor ? 'minor' : 'adult') as 'minor' | 'adult';
  const sameBand = (id: string) => id === me?.id || (OTHERS.find((o) => o.id === id)?.isMinor ?? false) === (me?.isMinor ?? false);
  const visibleUser = (id: string) => !blocked.has(id) && (viewer() === 'minor' || !OTHERS.find((o) => o.id === id)?.isMinor);
  const need = (): MyProfile => {
    if (!me) throw new Error('No profile');
    return me;
  };
  const myCheckIn = () => checkIns.filter((c) => c.userId === me?.id && now() - c.at < CHECKIN_TTL_MIN * 60_000).sort((a, b) => b.at - a.at)[0];

  function toRunView(r: (typeof runs)[number]): RunView {
    return {
      id: r.id, courtId: r.courtId, courtName: courts.find((c) => c.id === r.courtId)?.name ?? '?', hostId: r.hostId, hostName: name(r.hostId),
      startsAt: r.startsAt, tier: r.tier, lane: r.lane, presetId: r.presetId, note: r.note,
      members: r.members.filter(visibleUser).map((id) => ({ id, name: name(id) })),
      status: r.status, mine: r.hostId === me?.id, joined: r.members.includes(me?.id ?? ''),
    };
  }

  function finalize(rec: GameRecord): GameRecord {
    const profile = need();
    const win = winnerOf(rec.state);
    if (!win) return rec;
    // The signed-in user always plays side A in the demo.
    const won = win === 'A';
    const ck = myCheckIn();
    const policy = lanePolicy(rec.lane, { casualEloOptIn: profile.casualEloOptIn, checkedIn: ck?.courtId === rec.courtId });
    let ratingLine = 'Unrated game';
    const stats = (book.stats[rec.tier] ??= { games: 0, distinctOpponents: 0, opponents: new Set<string>() });
    const oppIds = rec.players.B.map((p) => p.id);
    const repeatOpp = oppIds.filter((o) => stats.opponents.has(o)).length ? Math.min(3, stats.games) : 0;
    const w = repeatWeight(repeatOpp, 0);

    if (policy === 'ranked_skill') {
      const mine = (book.ranked[rec.tier] ??= priorFor(otherTiers(rec.tier)));
      const mates = rec.players.A.slice(1).map(() => newSkill());
      const opps = rec.players.B.map(() => newSkill());
      const r = rateGame([mine, ...mates], opps, win, w);
      const u = r.A[0]!;
      book.ranked[rec.tier] = u.after;
      oppIds.forEach((o) => stats.opponents.add(o));
      stats.games += 1;
      stats.distinctOpponents = stats.opponents.size;
      ratingLine = `${u.reason} (${ratingLabel(u.after, stats)})`;
    } else if (policy === 'casual_elo') {
      const cur = (book.casualElo[rec.tier] ??= { rating: 1200, games: 0 });
      const u = eloUpdate(cur, cur.rating, 1200, won, w);
      book.casualElo[rec.tier] = { rating: u.rating, games: cur.games + 1 };
      ratingLine = `Casual Elo: ${u.reason} (${u.delta >= 0 ? '+' : ''}${u.delta})`;
    } else if (policy === 'private_elo') {
      const u = eloUpdate(book.privateElo, book.privateElo.rating, 1200, won, w);
      book.privateElo = { rating: u.rating, games: book.privateElo.games + 1 };
      book.privateHistory.push({ gameId: rec.id, rating: u.rating, delta: u.delta, at: now() });
      ratingLine = `Private: ${u.reason} (${u.delta >= 0 ? '+' : ''}${u.delta})`;
    } else if (rec.lane === 'ranked') {
      ratingLine = 'Not rated: you must be checked in at this court for ranked';
    }

    const gold = goldForGame({ lane: rec.lane, finalized: true, earnedToday: goldToday, firstGameOfDay: goldToday === 0 });
    goldToday += gold;
    profile.goldEarned += gold;
    return { ...rec, outcome: { ratingLine, goldAwarded: gold, unrated: policy === 'none' } };
  }

  const closet = (): Closet => ({ gold: need().goldEarned, owned: [...owned].sort(), loadout: { ...loadout } });

  const otherTiers = (except?: Tier) => (Object.keys(book.ranked) as unknown as Tier[]).filter((t) => Number(t) !== except).map((t) => ({ ...book.ranked[t]!, games: book.stats[t]?.games ?? 0 }));

  const seat = (id: string, n: string, accepted = true): GamePlayer => ({ id, name: n, accepted });

  return {
    supportsAuth: false,
    soloDemoGames: true,
    async isSignedIn() {
      return true;
    },
    async signInWithEmail() {},
    async verifyEmailCode() {},
    async signOut() {},

    async getProfile() {
      return me ? { ...me } : null;
    },
    async createProfile(displayName, birthDate) {
      const band = ageBand(birthDate, new Date(now()));
      if (band === 'blocked') throw new Error('age_blocked');
      me = {
        id: 'me', displayName, isMinor: band === 'minor', casualEloOptIn: false, avatar: defaultAvatarConfig(displayName), goldEarned: 0, goldBought: 0,
      };
      for (const i of starterItems()) owned.add(i.id);
      loadout = defaultLoadout();
      return { ...me };
    },
    async setCasualEloOptIn(on) {
      need().casualEloOptIn = on;
    },
    async setAvatar(a: AvatarConfig) {
      need().avatar = a;
    },

    async getCloset() {
      return closet();
    },
    async buyItem(id) {
      const p = need();
      const r = checkBuy(id, owned, p.goldEarned);
      if (!r.ok) throw new Error(r.error);
      p.goldEarned -= r.price;
      owned.add(id);
      return closet();
    },
    async equipItem(id) {
      need();
      const r = checkEquip(id, owned);
      if (!r.ok) throw new Error(r.error);
      loadout = { ...loadout, [r.slot]: id };
      return closet();
    },
    async unequipSlot(slot) {
      need();
      if (!OPTIONAL_SLOTS.includes(slot)) throw new Error('cannot_empty');
      loadout = { ...loadout };
      delete loadout[slot];
      return closet();
    },

    async listCourts(near?: LatLng) {
      need();
      const counts = headcountByCourt(checkIns.filter((c) => !blocked.has(c.userId)), viewer(), now());
      return courts
        .map((c) => ({ ...c, headcount: counts[c.id] ?? 0 }))
        .sort((a, b) => (near ? haversineMeters(near, a) - haversineMeters(near, b) : 0));
    },
    async checkIn(courtId, fix: Fix): Promise<CheckInResult> {
      const p = need();
      const court = courts.find((c) => c.id === courtId);
      if (!court) throw new Error('court_not_found');
      const d = evaluateCheckIn(fix, court);
      if (!d.ok) return { ok: false, reason: d.reason as 'too_far' | 'bad_fix', distanceM: d.distanceM };
      const i = checkIns.findIndex((c) => c.userId === p.id);
      if (i >= 0) checkIns.splice(i, 1);
      checkIns.push({ userId: p.id, courtId, at: now(), isMinor: p.isMinor });
      return { ok: true, reason: 'ok', distanceM: d.distanceM };
    },
    async checkOut() {
      const i = checkIns.findIndex((c) => c.userId === me?.id);
      if (i >= 0) checkIns.splice(i, 1);
    },
    async confirmCourtFit(courtId) {
      const c = courts.find((x) => x.id === courtId);
      if (c && myCheckIn()?.courtId === courtId) c.fitConfirmations += 1;
    },
    async myCheckInCourtId() {
      return myCheckIn()?.courtId ?? null;
    },

    async listRuns() {
      need();
      return runs.filter((r) => r.status === 'open' && visibleUser(r.hostId) && sameBand(r.hostId) && (r.lane !== 'private' || r.hostId === me?.id || r.invited.includes(me?.id ?? ''))).map(toRunView);
    },
    async createRun(r) {
      const p = need();
      runs.push({ id: uid('r'), hostId: p.id, members: [p.id], invited: [], status: 'open', ...r });
      usage.push(tierUsageEvent(p.id, r.lane, r.tier, now()));
    },
    async joinRun(id) {
      const r = runs.find((x) => x.id === id);
      if (r && r.status === 'open' && sameBand(r.hostId) && !r.members.includes(need().id) && (r.lane !== 'private' || r.invited.includes(need().id))) r.members.push(need().id);
    },
    async leaveRun(id) {
      const r = runs.find((x) => x.id === id);
      if (r) r.members = r.members.filter((m) => m !== need().id);
    },
    async cancelRun(id) {
      const r = runs.find((x) => x.id === id);
      if (r && r.hostId === need().id) r.status = 'cancelled';
    },

    async report(r) {
      need();
      reports.push(r);
    },
    async block(userId) {
      need();
      blocked.add(userId);
    },

    async createGame(g: NewGame) {
      const p = need();
      const court = courts.find((c) => c.id === g.courtId);
      if (!court) throw new Error('court_not_found');
      if (g.lane === 'ranked' && myCheckIn()?.courtId !== g.courtId) throw new Error('ranked_requires_check_in');
      if (g.tier === 5 && !fullCourtConfirmed(court)) {
        throw new Error(canPlayTierOnCourt(5, court.courtType) ? 'full_court_unconfirmed' : 'six_on_six_needs_court');
      }
      getPreset(g.presetId);
      const mates = Array.from({ length: g.tier - 1 }, (_, i) => seat(`bot-a${i}`, `Mate ${i + 1}`));
      const opps = Array.from({ length: g.tier }, (_, i) => seat(`bot-b${i}`, `Opp ${i + 1}`));
      const rec: GameRecord = {
        id: uid('g'), courtId: g.courtId, lane: g.lane, tier: g.tier, mode: g.mode, state: newGame(g.presetId, g.mode),
        players: { A: [seat(p.id, p.displayName), ...mates], B: opps }, mySide: null,
      };
      games.set(rec.id, rec);
      usage.push(tierUsageEvent(p.id, g.lane, g.tier, now()));
      return rec;
    },
    async getGame(id) {
      const g = games.get(id);
      if (!g) throw new Error('game_not_found');
      return g;
    },
    async startGameFromRun(runId, mode) {
      const p = need();
      const r = runs.find((x) => x.id === runId);
      if (!r || r.hostId !== p.id) throw new Error('only_host_can_start');
      const members = r.members.filter((m) => m !== p.id);
      const ids = [p.id, ...members];
      while (ids.length < r.tier * 2) ids.push(`guest-${ids.length}`); // demo fills empty seats
      const A: GamePlayer[] = [];
      const B: GamePlayer[] = [];
      // Other real people (u-*) must accept; placeholder guests are demo filler and count as accepted.
      ids.slice(0, r.tier * 2).forEach((id, i) => (i % 2 === 0 ? A : B).push(seat(id, name(id) === 'Player' ? `Guest ${i}` : name(id), id === p.id || !id.startsWith('u-'))));
      const lobby = [...A, ...B].some((x) => !x.accepted);
      const rec: GameRecord = { id: uid('g'), courtId: r.courtId, lane: r.lane, tier: r.tier, mode, state: newGame(r.presetId, mode, { lobby }), players: { A, B }, mySide: null };
      games.set(rec.id, rec);
      r.status = 'cancelled'; // a run that became a game leaves the board
      usage.push(tierUsageEvent(p.id, r.lane, r.tier, now()));
      return rec;
    },
    async sendEvent(id, ev: GameEvent) {
      let g = games.get(id);
      if (!g) throw new Error('game_not_found');
      const next = applyEvent(g.state, ev);
      const wasFinal = g.state.status === 'final';
      g = { ...g, state: next };
      if (next.status === 'final' && !wasFinal) g = finalize(g);
      games.set(id, g);
      return g;
    },
    async acceptGame(id) {
      const g = games.get(id);
      if (!g) throw new Error('game_not_found');
      if (g.state.status !== 'lobby') throw new Error('not_in_lobby');
      // Demo: accepting also stands in for the other humans accepting.
      const all = (xs: GamePlayer[]) => xs.map((x) => ({ ...x, accepted: true }));
      const next = { ...g, players: { A: all(g.players.A), B: all(g.players.B) }, state: applyEvent(g.state, { type: 'start' }) };
      games.set(id, next);
      return next;
    },
    async declineGame(id) {
      const g = games.get(id);
      if (!g) throw new Error('game_not_found');
      if (g.state.status !== 'lobby') throw new Error('already_started');
      const next = { ...g, state: applyEvent(g.state, { type: 'void', side: 'A' }) };
      games.set(id, next);
      return next;
    },

    async myFriendCode() {
      return 'DEMO1234';
    },
    async listFriends(): Promise<FriendView[]> {
      need();
      return friends.map((f) => {
        const ci = f.relation === 'friend' ? checkIns.find((c) => c.userId === f.id && now() - c.at < CHECKIN_TTL_MIN * 60_000) : undefined;
        const court = ci ? courts.find((c) => c.id === ci.courtId) : undefined;
        return { userId: f.id, name: f.name, relation: f.relation, requestId: f.requestId, courtName: court?.name, courtId: court?.id };
      });
    },
    async sendFriendRequest(code) {
      const p = need();
      const hit = CODES[code.trim().toUpperCase()];
      if (!hit || (hit.id === 'u-teen' && !p.isMinor)) throw new Error('friend_not_found');
      if (friends.some((f) => f.id === hit.id)) throw new Error('already_friends_or_pending');
      friends.push({ id: hit.id, name: hit.name, relation: 'outgoing', requestId: uid('fr') });
    },
    async respondFriendRequest(requestId, accept) {
      const i = friends.findIndex((f) => f.requestId === requestId && f.relation === 'incoming');
      if (i < 0) throw new Error('not_found');
      if (accept) friends[i]!.relation = 'friend';
      else friends.splice(i, 1);
    },
    async removeFriend(userId) {
      const i = friends.findIndex((f) => f.id === userId);
      if (i >= 0) friends.splice(i, 1);
    },
    async inviteToRun(runId, userId) {
      const r = runs.find((x) => x.id === runId);
      if (!r || r.hostId !== need().id || r.lane !== 'private') throw new Error('not_your_private_run');
      if (!friends.some((f) => f.id === userId && f.relation === 'friend')) throw new Error('not_friends');
      if (!r.invited.includes(userId)) r.invited.push(userId);
    },

    async leaderboard(tier): Promise<LeaderboardRow[]> {
      // Demo rows. The real leaderboard is ranked, adults only, past the provisional threshold, and includes deleted players by name.
      return [
        { rank: 1, name: 'Ana (demo)', rating: 1380 - tier * 10, range: 70, games: 41, deleted: false },
        { rank: 2, name: 'Bo (demo)', rating: 1290 - tier * 10, range: 85, games: 25, deleted: false },
        { rank: 3, name: 'Former player (demo)', rating: 1240 - tier * 10, range: 90, games: 18, deleted: true },
      ];
    },
    async myStats(): Promise<StatRow[]> {
      const acc = new Map<string, StatRow>();
      for (const g of games.values()) {
        if (g.state.status !== 'final') continue;
        const k = `${g.tier}-${g.lane}`;
        const row = acc.get(k) ?? { tier: g.tier, lane: g.lane, games: 0, wins: 0 };
        row.games += 1;
        if (winnerOf(g.state) === 'A') row.wins += 1; // demo user is always side A
        acc.set(k, row);
      }
      return [...acc.values()];
    },

    async ratePlayer() {},
    async submitFeedback(id, gameRating) {
      const g = games.get(id);
      if (g) games.set(id, { ...g, feedback: { gameRating } });
    },

    async getRatings(): Promise<MyRatings> {
      need();
      const ranked = (Object.keys(book.ranked) as unknown as Tier[]).map((t) => {
        const s = book.stats[t] ?? { games: 0, distinctOpponents: 0, opponents: new Set<string>() };
        return { tier: Number(t) as Tier, label: ratingLabel(book.ranked[t]!, s), stats: { games: s.games, distinctOpponents: s.distinctOpponents } };
      });
      const casualElo = (Object.keys(book.casualElo) as unknown as Tier[]).map((t) => ({ tier: Number(t) as Tier, rating: book.casualElo[t]!.rating }));
      return { ranked, casualElo, privateHistory: lastTenHistory(book.privateHistory), overall: overallRating(otherTiers()) };
    },
    async tierUsage() {
      return [...usage];
    },
    async deleteAccount(_keepName = true) {
      me = null;
      games.clear();
      usage.length = 0;
      book.ranked = {};
      book.stats = {};
      book.casualElo = {};
      book.privateHistory = [];
      book.privateElo = { rating: 1200, games: 0 };
    },
  };
}
