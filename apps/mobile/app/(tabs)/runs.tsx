import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { TIERS, getPreset, tierLabel, type Lane, type Tier } from '@vk/core';
import type { CourtView, FriendView, RunView } from '../../src/backend/types';
import { useApp } from '../../src/state/AppState';
import { LoadError } from '../../src/ui/LoadError';
import { PresetPicker } from '../../src/ui/PresetPicker';
import { useLoader } from '../../src/ui/useLoader';
import { Badge, Body, Brand, Button, Card, Chip, Dim, H1, H2, Row, Screen, colors } from '../../src/ui/kit';

const LANES: Lane[] = ['casual', 'private', 'ranked'];

export default function Runs() {
  const { backend } = useApp();
  const [runs, setRuns] = useState<RunView[]>([]);
  const [courts, setCourts] = useState<CourtView[]>([]);
  const [courtId, setCourtId] = useState<string>('c1');
  const [tier, setTier] = useState<Tier>(3);
  const [lane, setLane] = useState<Lane>('casual');
  const [presetId, setPresetId] = useState('11-1s2s-w1');
  const [err, setErr] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendView[]>([]);
  const [invited, setInvited] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setRuns(await backend.listRuns());
    setCourts(await backend.listCourts());
    setFriends((await backend.listFriends()).filter((f) => f.relation === 'friend'));
  }, [backend]);
  const { error: loadError, retry } = useLoader(load);

  const act = (f: () => Promise<void>) => async () => {
    try {
      await f();
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    await load();
  };
  const start = (r: RunView) => async () => {
    try {
      const g = await backend.startGameFromRun(r.id, 'live');
      router.push(`/game/${g.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen>
      <Brand />
      <H1>Run board</H1>
      <LoadError error={loadError} onRetry={retry} />
      {err && <Body style={{ color: colors.danger }} testID="run-error">{err}</Body>}
      {runs.length === 0 && <Dim>No runs yet. Post one below.</Dim>}
      {runs.map((r) => (
        <Card key={r.id}>
          <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <H2>
              {tierLabel(r.tier)} · {r.courtName}
            </H2>
            <Badge kind={r.lane}>{r.lane.toUpperCase()}</Badge>
          </Row>
          <Dim>
            {new Date(r.startsAt).toLocaleString()} · {getPreset(r.presetId).label}
          </Dim>
          {r.note && <Body>{r.note}</Body>}
          {r.lane === 'private' && <Dim>Invite-only: only invited friends can see and join.</Dim>}
          {r.lane === 'private' && r.mine && (
            <>
              <Dim>Invite friends{friends.length === 0 ? ' (add friends on the Friends tab first)' : ''}</Dim>
              {friends.map((f) => (
                <Row key={f.userId}>
                  <Body>{f.name}</Body>
                  <Dim>{f.courtName ? `at ${f.courtName}` : ''}</Dim>
                  <Button
                    title={invited[`${r.id}-${f.userId}`] ? 'Invited' : 'Invite'}
                    kind="ghost"
                    disabled={invited[`${r.id}-${f.userId}`]}
                    testID={`invite-${r.id}-${f.userId}`}
                    onPress={act(async () => { await backend.inviteToRun(r.id, f.userId); setInvited((x) => ({ ...x, [`${r.id}-${f.userId}`]: true })); })}
                  />
                </Row>
              ))}
            </>
          )}
          <Body testID={`members-${r.id}`}>Hosted by {r.hostName} · in: {r.members.map((m) => m.name).join(', ') || 'nobody'}</Body>
          <Row>
            {!r.mine && !r.joined && <Button title="Join" onPress={act(() => backend.joinRun(r.id))} testID={`join-${r.id}`} />}
            {!r.mine && r.joined && <Button title="Leave" kind="ghost" onPress={act(() => backend.leaveRun(r.id))} testID={`leave-${r.id}`} />}
            {r.mine && <Button title={`Start game (${r.members.length}/${r.tier * 2})`} onPress={start(r)} testID={`start-${r.id}`} />}
            {r.mine && <Button title="Cancel run" kind="danger" onPress={act(() => backend.cancelRun(r.id))} testID={`cancel-${r.id}`} />}
            {!r.mine && (
              <>
                <Button title="Report" kind="ghost" testID={`report-${r.id}`} onPress={() => router.push({ pathname: '/report', params: { targetType: 'run', targetId: r.id } })} />
                <Button title="Block host" kind="ghost" testID={`block-${r.id}`} onPress={act(() => backend.block(r.hostId))} />
              </>
            )}
          </Row>
        </Card>
      ))}

      <Card>
        <H2>Post a run</H2>
        <Row>{courts.map((c) => <Chip key={c.id} label={c.name.replace(' (demo)', '')} active={courtId === c.id} onPress={() => setCourtId(c.id)} />)}</Row>
        <Row style={{ flexWrap: 'nowrap' }}>{TIERS.map((t) => <Chip fill key={t} label={tierLabel(t)} active={tier === t} onPress={() => setTier(t)} />)}</Row>
        <Row style={{ flexWrap: 'nowrap' }}>{LANES.map((l) => <Chip fill key={l} label={l} active={lane === l} onPress={() => setLane(l)} />)}</Row>
        <PresetPicker value={presetId} onChange={setPresetId} idPrefix="run-" />
        <Button
          title="Post run"
          testID="post-run"
          onPress={act(() => backend.createRun({ courtId, startsAt: Date.now() + 3_600_000, tier, lane, presetId }))}
        />
      </Card>
    </Screen>
  );
}
