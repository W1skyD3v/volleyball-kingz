import { defaultAvatarConfig, type AvatarConfig } from '@vk/avatar';
import {
  overallRating, ratingLabel, type Loadout, type Fix, type GameEvent, type GameState, type Lane, type LatLng, type PlayMode, type ReportInput, type Side, type Tier, type TierUsageEvent,
} from '@vk/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createMemoryBackend } from './memory';
import type { Backend, CheckInResult, Closet, CourtView, FriendView, GamePlayer, GameRecord, LeaderboardRow, MyProfile, MyRatings, NewGame, NewRun, RunView, StatRow } from './types';

export interface SupabaseOptions {
  /** Resolve the signed-in user id. Default reads the local Supabase session (no network). */
  userId?: () => Promise<string | null>;
}

type Row = Record<string, unknown>;

function toCloset(d: unknown): Closet {
  const r = d as { gold: number; owned: string[]; loadout: Loadout };
  return { gold: r.gold, owned: r.owned ?? [], loadout: r.loadout ?? {} };
}

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message);
}

/**
 * Supabase adapter. All game changes go through the server RPCs (create_game, game_apply_event), so the server, not the
 * phone, decides what is legal. Ratings and Gold are written by the rating worker and only read here.
 * Covered by scripts/test-e2e.ts against a real PostgREST + Postgres (RLS and RPCs are real). Not covered: Supabase Auth
 * (email code login) and Realtime subscriptions, which need a full Supabase stack.
 */
export function createSupabaseBackend(client: SupabaseClient, opts: SupabaseOptions = {}): Backend {
  const uid = opts.userId ?? (async () => (await client.auth.getSession()).data.session?.user.id ?? null);
  const need = async (): Promise<string> => {
    const id = await uid();
    if (!id) throw new Error('not_signed_in');
    return id;
  };
  const rows = <T = Row>(r: { data: unknown; error: { message: string } | null }): T[] => {
    fail(r.error);
    return (r.data ?? []) as T[];
  };

  async function names(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const p = rows<{ id: string; display_name: string }>(await client.from('profiles').select('id,display_name').in('id', ids));
    return new Map(p.map((x) => [x.id, x.display_name]));
  }

  const toProfile = (d: Row): MyProfile => ({
    id: d.id as string,
    displayName: d.display_name as string,
    isMinor: d.is_minor as boolean,
    casualEloOptIn: d.casual_elo_opt_in as boolean,
    avatar: (d.avatar as AvatarConfig | null) ?? defaultAvatarConfig(d.display_name as string),
    goldEarned: d.gold_earned as number,
    goldBought: d.gold_bought as number,
  });

  const toCourt = (c: Row): CourtView => ({
    id: c.id as string,
    name: (c.name as string | null) ?? 'Unnamed court',
    lat: c.lat as number,
    lng: c.lng as number,
    courtType: c.court_type as CourtView['courtType'],
    typeSource: c.type_source as CourtView['typeSource'],
    headcount: (c.headcount as number | undefined) ?? 0,
    fitConfirmations: c.fit_confirmations as number,
    memberCount: c.member_count as number | undefined,
    distanceM: c.distance_m as number | undefined,
  });

  async function loadGame(id: string): Promise<GameRecord> {
    const me = await need();
    const g = rows(await client.from('games').select('*').eq('id', id))[0];
    if (!g) throw new Error('game_not_found');
    const gp = rows<{ user_id: string; side: Side; is_captain: boolean; game_rating: number | null; accepted_at: string | null }>(
      await client.from('game_players').select('user_id,side,is_captain,game_rating,accepted_at').eq('game_id', id),
    );
    const nm = await names(gp.map((p) => p.user_id));
    const seatOf = (s: Side): GamePlayer[] =>
      gp.filter((p) => p.side === s).sort((a, b) => Number(b.is_captain) - Number(a.is_captain)).map((p) => ({ id: p.user_id, name: nm.get(p.user_id) ?? 'Player', accepted: p.accepted_at !== null }));
    const mine = gp.find((p) => p.user_id === me);
    const rec: GameRecord = {
      id: g.id as string,
      courtId: g.court_id as string,
      lane: g.lane as Lane,
      tier: g.tier as Tier,
      mode: g.mode as PlayMode,
      state: g.state as GameState,
      players: { A: seatOf('A'), B: seatOf('B') },
      mySide: mine && mine.is_captain ? mine.side : null,
    };
    if (mine?.game_rating) rec.feedback = { gameRating: mine.game_rating };
    if (g.status === 'final') {
      const ev = rows<{ reason: string }>(await client.from('rating_events').select('reason').eq('game_id', id).eq('user_id', me));
      const gold = rows<{ amount: number }>(await client.from('gold_ledger').select('amount').eq('game_id', id).eq('user_id', me));
      const goldAwarded = gold.reduce((s, x) => s + x.amount, 0);
      const pending = ev.length === 0 && gold.length === 0;
      rec.outcome = {
        ratingLine: pending ? 'Result is being processed' : ev[0]?.reason ?? (g.lane === 'ranked' ? 'Not rated' : 'Unrated game'),
        goldAwarded,
        unrated: ev.length === 0,
        pending,
      };
    }
    return rec;
  }

  return {
    supportsAuth: true,
    soloDemoGames: false,
    async isSignedIn() {
      return (await uid()) !== null;
    },
    async signInWithEmail(email) {
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      fail(error);
    },
    async verifyEmailCode(email, code) {
      const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
      fail(error);
    },
    async signOut() {
      await client.auth.signOut();
    },

    async getProfile() {
      if (!(await uid())) return null;
      // Own full row only via my_profile(): other columns (birth year, friend code, Gold) are not readable from the table.
      const { data, error } = await client.rpc('my_profile');
      fail(error);
      const d = (Array.isArray(data) ? data[0] : data) as Row | null;
      return d && d.id ? toProfile(d) : null;
    },
    async createProfile(displayName, birthDate) {
      const { data, error } = await client.rpc('create_profile', { p_display_name: displayName, p_birth_date: birthDate.toISOString().slice(0, 10) });
      fail(error);
      return toProfile(data as Row);
    },
    async setCasualEloOptIn(on) {
      fail((await client.from('profiles').update({ casual_elo_opt_in: on }).eq('id', await need())).error);
    },
    async setAvatar(a: AvatarConfig) {
      fail((await client.from('profiles').update({ avatar: a }).eq('id', await need())).error);
    },

    async getCloset() {
      const { data, error } = await client.rpc('my_closet');
      fail(error);
      return toCloset(data);
    },
    async buyItem(id) {
      fail((await client.rpc('buy_item', { p_item: id })).error);
      return this.getCloset();
    },
    async equipItem(id) {
      fail((await client.rpc('equip_item', { p_item: id })).error);
      return this.getCloset();
    },
    async unequipSlot(slot) {
      fail((await client.rpc('unequip_slot', { p_slot: slot })).error);
      return this.getCloset();
    },

    async listCourts(near?: LatLng) {
      if (near) {
        return rows(await client.rpc('courts_near', { p_lat: near.lat, p_lng: near.lng, p_radius_m: 15000, p_limit: 50 })).map(toCourt);
      }
      const [courts, counts] = await Promise.all([client.from('courts').select('*').limit(50), client.rpc('court_headcounts')]);
      const byCourt = new Map(rows<{ court_id: string; headcount: number }>(counts).map((c) => [c.court_id, c.headcount]));
      return rows(courts).map((c) => toCourt({ ...c, headcount: byCourt.get(c.id as string) ?? 0 }));
    },
    async checkIn(courtId, fix: Fix): Promise<CheckInResult> {
      const { data, error } = await client.rpc('check_in', { p_court_id: courtId, p_lat: fix.lat, p_lng: fix.lng, p_accuracy_m: fix.accuracyM ?? 0 });
      if (error) {
        if (error.message.includes('too_far')) return { ok: false, reason: 'too_far' };
        if (/out of range|invalid|coordinate/i.test(error.message)) return { ok: false, reason: 'bad_fix' };
        throw new Error(error.message); // court_not_found, not authenticated, anything unexpected: surface it, never blame the GPS
      }
      return { ok: true, reason: 'ok', distanceM: (data as Row).distance_m as number };
    },
    async checkOut() {
      fail((await client.rpc('check_out')).error);
    },
    async confirmCourtFit(courtId) {
      fail((await client.rpc('confirm_court_fit', { p_court: courtId })).error);
    },
    async myCheckInCourtId() {
      const r = rows(await client.from('check_ins').select('court_id').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1));
      return (r[0]?.court_id as string | undefined) ?? null;
    },

    async listRuns() {
      const me = await need();
      const runs = rows(await client.from('runs').select('*').eq('status', 'open').order('starts_at'));
      if (!runs.length) return [];
      const members = rows<{ run_id: string; user_id: string }>(await client.from('run_members').select('run_id,user_id,joined_at').in('run_id', runs.map((r) => r.id as string)).order('joined_at'));
      const courts = rows<{ id: string; name: string | null }>(await client.from('courts').select('id,name').in('id', [...new Set(runs.map((r) => r.court_id as string))]));
      const nm = await names([...new Set([...members.map((m) => m.user_id), ...runs.map((r) => r.host_id as string)])]);
      return runs.map((r): RunView => {
        const mem = members.filter((m) => m.run_id === r.id).map((m) => ({ id: m.user_id, name: nm.get(m.user_id) ?? 'Player' }));
        return {
          id: r.id as string,
          courtId: r.court_id as string,
          courtName: courts.find((c) => c.id === r.court_id)?.name ?? 'Unnamed court',
          hostId: r.host_id as string,
          hostName: nm.get(r.host_id as string) ?? 'Player',
          startsAt: Date.parse(r.starts_at as string),
          tier: r.tier as Tier,
          lane: r.lane as Lane,
          presetId: r.preset_id as string,
          note: (r.note as string | null) ?? undefined,
          members: mem,
          status: 'open',
          mine: r.host_id === me,
          joined: mem.some((m) => m.id === me),
        };
      });
    },
    async createRun(r: NewRun) {
      const me = await need();
      const run = rows(
        await client.from('runs').insert({ court_id: r.courtId, host_id: me, starts_at: new Date(r.startsAt).toISOString(), tier: r.tier, lane: r.lane, preset_id: r.presetId, note: r.note }).select('id'),
      )[0]!;
      fail((await client.from('run_members').insert({ run_id: run.id, user_id: me })).error);
    },
    async joinRun(id) {
      fail((await client.from('run_members').insert({ run_id: id, user_id: await need() })).error);
    },
    async leaveRun(id) {
      fail((await client.from('run_members').delete().eq('run_id', id).eq('user_id', await need())).error);
    },
    async cancelRun(id) {
      fail((await client.from('runs').update({ status: 'cancelled' }).eq('id', id).eq('host_id', await need())).error);
    },

    async report(r: ReportInput) {
      fail((await client.from('reports').insert({
        reporter_id: await need(), target_type: r.targetType, target_id: r.targetId, reason: r.reason, details: r.details, safety_escalation: r.safetyEscalation,
      })).error);
    },
    async block(userId) {
      fail((await client.from('blocks').insert({ blocker_id: await need(), blocked_id: userId })).error);
    },

    async createGame(_g: NewGame): Promise<GameRecord> {
      throw new Error('start_games_from_a_run');
    },
    async startGameFromRun(runId, mode) {
      const me = await need();
      const run = rows(await client.from('runs').select('*').eq('id', runId))[0];
      if (!run || run.host_id !== me) throw new Error('only_host_can_start');
      const members = rows<{ user_id: string }>(await client.from('run_members').select('user_id,joined_at').eq('run_id', runId).order('joined_at')).map((m) => m.user_id);
      const tier = run.tier as number;
      if (members.length !== tier * 2) throw new Error('need_exactly_' + tier * 2 + '_players');
      const ordered = [me, ...members.filter((m) => m !== me)];
      const A = ordered.filter((_, i) => i % 2 === 0);
      const B = ordered.filter((_, i) => i % 2 === 1);
      const { data, error } = await client.rpc('create_game', {
        p_court: run.court_id, p_lane: run.lane, p_tier: tier, p_preset: run.preset_id, p_mode: mode, p_side_a: A, p_side_b: B,
      });
      fail(error);
      fail((await client.from('runs').update({ status: 'done' }).eq('id', runId)).error);
      return loadGame((data as Row).id as string);
    },
    getGame: (id) => loadGame(id),
    async acceptGame(id) {
      fail((await client.rpc('accept_game', { p_game: id })).error);
      return loadGame(id);
    },
    async declineGame(id) {
      fail((await client.rpc('decline_game', { p_game: id })).error);
      return loadGame(id);
    },

    async myFriendCode() {
      const { data, error } = await client.rpc('my_friend_code');
      fail(error);
      return data as string;
    },
    async listFriends() {
      return rows(await client.rpc('list_friends')).map((f): FriendView => ({
        userId: f.user_id as string, name: f.display_name as string, relation: f.relation as FriendView['relation'], requestId: f.request_id as string,
        courtName: (f.court_name as string | null) ?? undefined, courtId: (f.court_id as string | null) ?? undefined,
      }));
    },
    async sendFriendRequest(code) {
      const { data, error } = await client.rpc('send_friend_request', { p_code: code });
      fail(error);
      if (data !== 'sent' && data !== 'accepted') throw new Error(String(data)); // friend_not_found | already_friends_or_pending | rate_limited
    },
    async respondFriendRequest(requestId, accept) {
      fail((await client.rpc('respond_friend_request', { p_id: requestId, p_accept: accept })).error);
    },
    async removeFriend(userId) {
      fail((await client.rpc('remove_friend', { p_user: userId })).error);
    },
    async inviteToRun(runId, userId) {
      fail((await client.rpc('invite_to_run', { p_run: runId, p_user: userId })).error);
    },

    async leaderboard(tier) {
      return rows(await client.rpc('leaderboard', { p_tier: tier, p_limit: 50 })).map((r): LeaderboardRow => ({
        rank: r.rank as number, name: r.display_name as string, rating: r.rating as number, range: r.range as number, games: r.games as number, deleted: r.deleted as boolean,
      }));
    },
    async myStats() {
      return rows(await client.rpc('player_stats', { p_user: await need() })).map((r): StatRow => ({
        tier: r.tier as Tier, lane: r.lane as Lane, games: r.games as number, wins: r.wins as number,
      }));
    },
    async sendEvent(id, ev: GameEvent) {
      const { side: _side, at: _at, ...payload } = ev as GameEvent & { side?: Side; at?: number };
      void _side; void _at;
      fail((await client.rpc('game_apply_event', { p_game: id, p_event: payload })).error);
      return loadGame(id);
    },
    subscribeGame(id, onChange) {
      const channel = client
        .channel(`game:${id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${id}` }, () => {
          void loadGame(id).then(onChange);
        })
        .subscribe();
      return () => void client.removeChannel(channel);
    },
    async submitFeedback(id, gameRating) {
      fail((await client.rpc('rate_game', { p_game: id, p_stars: gameRating })).error);
    },
    async ratePlayer(gameId, userId, stars) {
      fail((await client.rpc('rate_player', { p_game: gameId, p_ratee: userId, p_stars: stars })).error);
    },

    async getRatings(): Promise<MyRatings> {
      const me = await need();
      const rs = rows(await client.from('ratings').select('*').eq('user_id', me));
      const ranked = rs.filter((r) => r.kind === 'ranked').map((r) => {
        const stats = { games: r.games as number, distinctOpponents: r.distinct_opponents as number };
        const skill = { mu: r.mu as number, sigma: r.sigma as number };
        return { tier: r.tier as Tier, label: ratingLabel(skill, stats), stats };
      });
      const casualElo = rs.filter((r) => r.kind === 'casual_elo').map((r) => ({ tier: r.tier as Tier, rating: Math.round(r.elo as number) }));
      const ev = rows(await client.from('rating_events').select('game_id,before_rating,after_rating,created_at').eq('user_id', me).eq('kind', 'private_elo').order('created_at', { ascending: false }).limit(10));
      const privateHistory = ev.reverse().map((e) => ({
        gameId: e.game_id as string, rating: e.after_rating as number, delta: (e.after_rating as number) - (e.before_rating as number), at: Date.parse(e.created_at as string),
      }));
      const overall = overallRating(rs.filter((r) => r.kind === 'ranked').map((r) => ({ mu: r.mu as number, sigma: r.sigma as number, games: r.games as number })));
      return { ranked, casualElo, privateHistory, overall };
    },
    async tierUsage() {
      return rows(await client.from('tier_usage').select('user_id,lane,tier,created_at')).map((t): TierUsageEvent => ({
        userId: t.user_id as string, lane: t.lane as Lane, tier: t.tier as Tier, at: Date.parse(t.created_at as string),
      }));
    },
    async deleteAccount(keepName = true) {
      fail((await client.rpc('delete_my_account', { p_keep_name: keepName })).error);
      try {
        await client.auth.signOut();
      } catch {
        /* session already gone */
      }
    },
  };
}

export function backendFromEnv(): Backend {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key && !key.startsWith('replace-with')) return createSupabaseBackend(createClient(url, key));
  return createMemoryBackend();
}
