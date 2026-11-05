import React, { useCallback, useState } from 'react';
import { Alert, Platform, Switch } from 'react-native';
import { TIERS, tierLabel, type Loadout, type Tier } from '@vk/core';
import type { LeaderboardRow, MyRatings, StatRow } from '../../src/backend/types';
import { useApp } from '../../src/state/AppState';
import { AvatarEditor } from '../../src/ui/AvatarEditor';
import { LoadError } from '../../src/ui/LoadError';
import { useLoader } from '../../src/ui/useLoader';
import { THEMES, type ThemeName } from '../../src/ui/kit';
import { THEME_NAMES, useTheme } from '../../src/state/theme';
import { Badge, BigNumber, Body, Brand, Button, Card, Chip, Dim, H1, H2, Row, Screen, colors } from '../../src/ui/kit';

export default function Profile() {
  const { backend, profile, refreshProfile } = useApp();
  const [ratings, setRatings] = useState<MyRatings | null>(null);
  const [usage, setUsage] = useState(0);
  const [stats, setStats] = useState<StatRow[]>([]);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [boardTier, setBoardTier] = useState<Tier>(1);
  const [keepName, setKeepName] = useState(true);
  const [loadout, setLoadout] = useState<Loadout>({});
  const { theme, setTheme } = useTheme();

  const loadMine = useCallback(async () => {
    await refreshProfile();
    setRatings(await backend.getRatings());
    setUsage((await backend.tierUsage()).length);
    setStats(await backend.myStats());
    setLoadout((await backend.getCloset()).loadout);
  }, [backend, refreshProfile]);
  const { error: loadError, retry } = useLoader(loadMine);

  const loadBoard = useCallback(async () => setBoard(await backend.leaderboard(boardTier)), [backend, boardTier]);
  const { error: boardError, retry: retryBoard } = useLoader(loadBoard);

  async function reallyDelete() {
    await backend.deleteAccount(keepName);
    await refreshProfile();
  }
  function confirmDelete() {
    if (Platform.OS === 'web') {
      void reallyDelete();
      return;
    }
    Alert.alert('Delete account', keepName ? 'Your login, avatar, friends, Royalty Bucks and private stats are deleted. Your name and ranked stats stay on leaderboards.' : 'Your account and name are deleted. Ranked games you played stay, under "Deleted player".', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void reallyDelete() },
    ]);
  }

  if (!profile) return null;
  return (
    <Screen>
      <Brand />
      <H1>{profile.displayName}</H1>
      <LoadError error={loadError ?? boardError} onRetry={loadError ? retry : retryBoard} />
      <Card>
        <AvatarEditor value={profile.avatar} loadout={loadout} onChange={async (a) => { await backend.setAvatar(a); await refreshProfile(); }} />
        <Row>
          <Badge kind="ranked" testID="gold">Royalty Bucks: {profile.goldEarned} earned</Badge>
        </Row>
        <Dim>Earned by playing. Purchases (King Credits) are not available in this build, and bought currency never affects rating.</Dim>
      </Card>

      <Card>
        <H2>App style</H2>
        <Row style={{ flexWrap: 'nowrap' }}>
          {THEME_NAMES.map((n: ThemeName) => <Chip fill key={n} label={THEMES[n].label} testID={`theme-${n}`} active={theme === n} onPress={() => setTheme(n)} />)}
        </Row>
        <Dim>{THEMES[theme].blurb}. Only the look changes.</Dim>
      </Card>

      <Card>
        <H2>Overall</H2>
        {ratings?.overall ? (
          <>
            <BigNumber testID="overall" value={ratings.overall.rating} size={72} color={colors.gold} />
            <Dim>across {ratings.overall.tiers} {ratings.overall.tiers === 1 ? 'game size' : 'game sizes'}</Dim>
          </>
        ) : (
          <Dim>Shown after 10 ranked games in any one size.</Dim>
        )}
        <H2>Ranked ratings (per tier)</H2>
        {ratings?.ranked.length ? ratings.ranked.map((r) => <Body key={r.tier} testID={`rating-${r.tier}`}>{tierLabel(r.tier)}: {r.label}</Body>) : <Dim>No ranked games yet.</Dim>}
        <H2>Casual Elo (separate)</H2>
        <Row>
          <Switch testID="casual-elo" accessibilityLabel="Casual Elo opt-in" value={profile.casualEloOptIn} onValueChange={async (v) => { await backend.setCasualEloOptIn(v); await refreshProfile(); }} />
          <Dim>Put a casual-only rating on the line. Never touches ranked.</Dim>
        </Row>
        {ratings?.casualElo.map((c) => <Body key={c.tier}>{tierLabel(c.tier)}: {c.rating}</Body>)}
        <H2>Private games: last 10</H2>
        {ratings?.privateHistory.length ? ratings.privateHistory.map((h) => <Dim key={h.gameId}>{h.rating} ({h.delta >= 0 ? '+' : ''}{h.delta})</Dim>) : <Dim>None yet.</Dim>}
        <Dim>Tier usage logged: {usage} (no limit is enforced in this build)</Dim>
      </Card>

      <Card>
        <H2>My history</H2>
        {stats.length === 0 ? <Dim>No finished games yet.</Dim> : stats.map((r) => <Body key={`${r.tier}-${r.lane}`} testID={`stat-${r.tier}-${r.lane}`}>{tierLabel(r.tier)} {r.lane}: {r.wins}-{r.games - r.wins}</Body>)}
        <Dim>Private games appear only here, never on anyone else's view.</Dim>
      </Card>

      <Card>
        <H2>Leaderboard (ranked, adults)</H2>
        <Row>{TIERS.map((t) => <Chip key={t} label={tierLabel(t)} testID={`board-tier-${t}`} active={boardTier === t} onPress={() => setBoardTier(t)} />)}</Row>
        {board.length === 0 ? <Dim>Nobody has played enough rated games here yet.</Dim> : board.map((r) => <Body key={r.rank} testID={`board-${r.rank}`}>{r.rank}. {r.name}{r.deleted ? ' (account deleted)' : ''}: {r.rating} +/- {r.range}</Body>)}
      </Card>

      <Card>
        <H2>Account</H2>
        <Dim>You can also delete your account on the web (link added before release).</Dim>
        {backend.supportsAuth && <Button title="Sign out" kind="ghost" testID="sign-out" onPress={async () => { await backend.signOut(); await refreshProfile(); }} />}
        <Row>
          <Switch testID="keep-name" accessibilityLabel="Keep my name and ranked stats after deleting" value={keepName} onValueChange={setKeepName} />
          <Dim>Keep my name and ranked stats on leaderboards after deleting</Dim>
        </Row>
        <Button title="Delete my account" kind="danger" onPress={confirmDelete} testID="delete-account" />
      </Card>
    </Screen>
  );
}
