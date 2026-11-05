import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { TIERS, tierLabel, type Lane, type PlayMode, type Tier } from '@vk/core';
import type { CourtView } from '../../src/backend/types';
import { useApp } from '../../src/state/AppState';
import { PresetPicker } from '../../src/ui/PresetPicker';
import { Label, Body, Brand, Button, Card, Chip, Dim, H1, Row, Screen, colors } from '../../src/ui/kit';

const LANES: { id: Lane; hint: string }[] = [
  { id: 'casual', hint: 'No rating (opt in to a separate Casual Elo in Me)' },
  { id: 'private', hint: 'Friends only; Elo history of your last 10 games' },
  { id: 'ranked', hint: 'Rated per tier; you must be checked in at the court' },
];

export default function Play() {
  const { backend } = useApp();
  const [courts, setCourts] = useState<CourtView[]>([]);
  const [courtId, setCourtId] = useState('c1');
  const [lane, setLane] = useState<Lane>('casual');
  const [tier, setTier] = useState<Tier>(1);
  const [pid, setPid] = useState('11-1s-w2');
  const [mode, setMode] = useState<PlayMode>('live');
  const [err, setErr] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setCourts(await backend.listCourts());
        const mine = await backend.myCheckInCourtId();
        if (mine) setCourtId(mine);
      })();
    }, [backend]),
  );

  const ERR: Record<string, string> = {
    ranked_requires_check_in: 'Ranked needs a live check-in at this court. Check in on the Courts tab.',
    five_on_five_needs_full_court: '5v5 is full court only. This court is not a full court.',
    full_court_unconfirmed: '5v5 needs a full court that a player has confirmed. Confirm it after checking in.',
  };

  async function start() {
    try {
      const g = await backend.createGame({ courtId, lane, tier, presetId: pid, mode });
      setErr(null);
      router.push(`/game/${g.id}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(ERR[m] ?? m);
    }
  }

  return (
    <Screen>
      <Brand />
      <H1>Start a game</H1>
      <Dim>Everyone confirms before it counts.</Dim>
      <Card style={{ gap: 14 }}>
        <Label>Court</Label>
        <Row>{courts.map((c) => <Chip key={c.id} label={c.name.replace(' (demo)', '')} active={courtId === c.id} onPress={() => setCourtId(c.id)} />)}</Row>
        <Label>Type</Label>
        <Row style={{ flexWrap: 'nowrap' }}>{LANES.map((l) => <Chip fill key={l.id} label={l.id} testID={`lane-${l.id}`} active={lane === l.id} onPress={() => setLane(l.id)} />)}</Row>
        <Dim>{LANES.find((l) => l.id === lane)?.hint}</Dim>
        <Label>Players per side</Label>
        <Row style={{ flexWrap: 'nowrap' }}>{TIERS.map((t) => <Chip fill key={t} label={tierLabel(t)} testID={`tier-${t}`} active={tier === t} onPress={() => setTier(t)} />)}</Row>
        <Label>Play to</Label>
        <PresetPicker value={pid} onChange={setPid} />
        <Label>Scoring mode</Label>
        <Row>
          <Chip label="Live: every point" testID="mode-live" active={mode === 'live'} onPress={() => setMode('live')} />
          <Chip label="Quick: end only" testID="mode-quick" active={mode === 'quick'} onPress={() => setMode('quick')} />
        </Row>
        {err && <Body style={{ color: colors.danger }} testID="start-error">{err}</Body>}
        <Dim>{mode === 'live' ? 'Both sides confirm every point as it happens.' : 'Play normally, then confirm the final score once.'}</Dim>
        {backend.soloDemoGames ? (
          <Button title="Start game" onPress={start} testID="start-game" />
        ) : (
          <Dim>Games start from a run: post a run on the Run board, let players join, then the host starts it.</Dim>
        )}
      </Card>
    </Screen>
  );
}
