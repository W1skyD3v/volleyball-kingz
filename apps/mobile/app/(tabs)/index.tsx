import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { haversineMeters, tierLabel } from '@vk/core';
import type { Fix } from '@vk/core';
import type { CourtView } from '../../src/backend/types';
import { getForegroundFix } from '../../src/location';
import { useApp } from '../../src/state/AppState';
import { LoadError } from '../../src/ui/LoadError';
import { useLoader } from '../../src/ui/useLoader';
import { Badge, Body, Brand, Button, Card, Dim, H1, H2, Row, Screen, colors } from '../../src/ui/kit';
import { View } from 'react-native';

const TYPE_LABEL = { full: 'Full court', half: 'Half court', unknown: 'Court size unknown' } as const;

export default function Courts() {
  const { backend } = useApp();
  const [courts, setCourts] = useState<CourtView[]>([]);
  const [fix, setFix] = useState<Fix | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [locMsg, setLocMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setCourts(await backend.listCourts(fix ?? undefined));
    setMine(await backend.myCheckInCourtId());
  }, [backend, fix]);
  const { error, retry } = useLoader(load);

  async function nearMe() {
    const r = await getForegroundFix();
    if (!r.ok) {
      setLocMsg(r.reason === 'no_permission' ? 'Location permission is needed to sort by distance.' : 'Could not get your location.');
      return;
    }
    setLocMsg(null);
    setFix(r.fix);
  }

  async function checkIn(c: CourtView) {
    const r = await getForegroundFix();
    if (!r.ok) {
      setMsg((m) => ({ ...m, [c.id]: r.reason === 'no_permission' ? 'Location permission is needed to check in.' : 'Could not get your location.' }));
      return;
    }
    setFix(r.fix);
    const res = await backend.checkIn(c.id, r.fix);
    setMsg((m) => ({
      ...m,
      [c.id]: res.ok ? `Checked in. Valid for 90 minutes.` : res.reason === 'too_far' ? `Too far from the court (${Math.round(res.distanceM ?? 0)} m).` : 'Bad location fix.',
    }));
    await load();
  }

  return (
    <Screen>
      <Brand />
      <H1>Courts near you</H1>
      <LoadError error={error} onRetry={retry} />
      <Dim>Check in only works at the court, with the app open. Minors never appear to adults.</Dim>
      <Row>
        <Button title={fix ? 'Refresh my location' : 'Sort by distance'} kind="ghost" onPress={nearMe} testID="near-me" />
        {locMsg && <Dim>{locMsg}</Dim>}
      </Row>
      {courts.map((c) => (
        <Card key={c.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <H2>{c.name}</H2>
              <Dim>
                {c.memberCount && c.memberCount > 1 ? `${c.memberCount} hoops/courts · ` : ''}
                {TYPE_LABEL[c.courtType]}
                {c.typeSource === 'tag' && c.fitConfirmations === 0 ? ' (estimate)' : ''}
                {fix ? ` · ${Math.round(c.distanceM ?? haversineMeters(fix, c))} m away` : ''}
              </Dim>
            </View>
            <Badge kind={c.headcount > 0 ? 'live' : 'quiet'} testID={`headcount-${c.id}`}>{c.headcount} here now</Badge>
          </View>
          {mine === c.id && <Body style={{ color: colors.ok, fontFamily: 'Barlow_600SemiBold' }}>You are checked in here</Body>}
          <Row>
            <Button title={mine === c.id ? 'Re-check in' : 'Check in'} onPress={() => checkIn(c)} testID={`checkin-${c.id}`} />
            {mine === c.id && <Button title="I'm leaving" kind="ghost" onPress={async () => { await backend.checkOut(); setMsg((m) => ({ ...m, [c.id]: 'Checked out.' })); await load(); }} testID={`checkout-${c.id}`} />}
            {mine === c.id && c.courtType === 'full' && c.fitConfirmations === 0 && (
              <Button title="Confirm full court" kind="ghost" onPress={async () => { await backend.confirmCourtFit(c.id); await load(); }} testID={`confirmfull-${c.id}`} />
            )}
          </Row>
          {msg[c.id] && <Dim>{msg[c.id]}</Dim>}
          <Button title="Report a problem with this court" kind="ghost" testID={`report-court-${c.id}`} onPress={() => router.push({ pathname: '/report', params: { targetType: 'court', targetId: c.id } })} />
          <Dim>5v5 {c.courtType === 'full' && c.fitConfirmations > 0 ? 'allowed' : 'locked until a full court is confirmed'} · up to {tierLabel(4)} otherwise</Dim>
        </Card>
      ))}
    </Screen>
  );
}
