import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { allowedPoints, getPreset, otherSide, type GameEvent, type Loadout, type Side } from '@vk/core';
import type { GameRecord } from '../../src/backend/types';
import { useApp } from '../../src/state/AppState';
import { Badge, BigNumber, Body, Button, Card, Chip, Dim, H2, Label, Row, Screen, colors } from '../../src/ui/kit';
import { Replay } from '../../src/ui/Replay';
import { LiveCourt } from '../../src/ui/LiveCourt';
import { teamsFor } from '../../src/ui/teams';

const POLL_MS = 4000;

/**
 * Two-device play: each captain sees and controls only their own side (mySide), and the server decides legality.
 * Demo backend (mySide = null): one phone plays both captains ("pass the phone").
 */
export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { backend, profile } = useApp();
  const [rec, setRec] = useState<GameRecord | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [quickA, setQuickA] = useState('');
  const [quickB, setQuickB] = useState('');
  const [rated, setRated] = useState<Record<string, number>>({});
  const [watching, setWatching] = useState(false);
  const [scorer, setScorer] = useState<Record<Side, string | null>>({ A: null, B: null });
  const [loadout, setLoadout] = useState<Loadout>({});

  useEffect(() => {
    void backend.getGame(id).then(setRec);
  }, [backend, id]);

  useEffect(() => {
    void backend.getCloset().then((c) => setLoadout(c.loadout)).catch(() => undefined);
  }, [backend]);

  // Live updates: Realtime when the backend has it, plus a slow poll as a safety net (and to pick up the rating result).
  const live = backend.supportsAuth;
  const open = rec ? rec.state.status !== 'voided' && !(rec.state.status === 'final' && !rec.outcome?.pending) : false;
  useEffect(() => {
    if (!live || !open) return;
    const off = backend.subscribeGame?.(id, setRec);
    const t = setInterval(() => void backend.getGame(id).then(setRec).catch(() => undefined), POLL_MS);
    return () => {
      clearInterval(t);
      off?.();
    };
  }, [backend, id, live, open]);

  const dispatch = useCallback(
    async (ev: GameEvent) => {
      if (!rec) return;
      try {
        setRec(await backend.sendEvent(rec.id, ev));
        setErr(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [rec, backend],
  );

  const act = useCallback(
    async (f: () => Promise<GameRecord>) => {
      try {
        setRec(await f());
        setErr(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  if (!rec) return null;
  const s = rec.state;
  const preset = getPreset(s.presetId);
  const sides: Side[] = ['A', 'B'];
  const can = (x: Side) => rec.mySide === null || rec.mySide === x;
  const me: Side = rec.mySide ?? 'A';
  const label = (x: Side) => `${x}: ${rec.players[x][0]?.name ?? '?'}${rec.players[x].length > 1 ? ' + team' : ''}`;
  const quickScore = { A: Number(quickA), B: Number(quickB) };
  const input = { color: colors.text, backgroundColor: colors.card, padding: 10, borderRadius: 8, minWidth: 80 } as const;
  const voidAsk = s.voidRequest?.by;
  const voidLabel = voidAsk && voidAsk !== me ? `Agree to void (Side ${voidAsk} asked)` : voidAsk ? 'Void requested: waiting for the other side' : 'Ask to void';
  const waiting = (who: Side) => <Dim>Waiting for Side {who} ({rec.players[who][0]?.name})…</Dim>;
  const seated = [...rec.players.A, ...rec.players.B];
  const iAmSeated = seated.some((p) => p.id === profile?.id);
  const myAccepted = seated.find((p) => p.id === profile?.id)?.accepted ?? false;
  const everyone = [...rec.players.A, ...rec.players.B].filter((p) => p.id !== profile?.id && !p.id.startsWith('bot') && !p.id.startsWith('guest'));

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Badge kind={s.status === 'active' ? 'live' : 'quiet'}>{s.status === 'active' ? `LIVE · ${preset.label}` : preset.label}</Badge>
        {/* Always-reachable safety alert: routes to a human reviewer. */}
        <Button title="⚑" accessibilityLabel="Report a safety problem" kind="ghost" testID="alert-button" onPress={() => router.push({ pathname: '/report', params: { targetType: 'game', targetId: rec.id, safety: '1' } })} />
      </Row>
      {watching && profile && s.status === 'final' && (
        <Card>
          <Replay state={s} mySide={rec.mySide ?? 'A'} teams={teamsFor(rec, profile, loadout)} onClose={() => setWatching(false)} />
        </Card>
      )}
      {profile && (s.status === 'active' || s.status === 'awaiting_final') && <LiveCourt teams={teamsFor(rec, profile, loadout)} score={s.score} active={s.status === 'active'} />}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {(['A', 'B'] as const).map((x) => {
          const mine = rec.mySide === x;
          return (
            <View key={x} style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 20, backgroundColor: colors.card, borderWidth: mine ? 2 : 1, borderColor: mine ? colors.gold : colors.line }}>
              <Label>{rec.mySide ? (mine ? 'Your team' : 'Them') : `Side ${x}`}</Label>
              <BigNumber testID={`score-${x}`} value={s.score[x]} size={104} color={mine ? colors.gold : colors.text} />
            </View>
          );
        })}
      </View>
      {voidAsk && s.status !== 'lobby' && (
        <Card>
          <Body testID="void-banner">Side {voidAsk} asked to void this game. A void needs both captains.</Body>
          {can(voidAsk === 'A' ? 'B' : 'A') && <Button title="Agree to void" kind="danger" testID="void-agree" onPress={() => dispatch({ type: 'void', side: voidAsk === 'A' ? 'B' : 'A' })} />}
        </Card>
      )}
      <Dim>{rec.lane} game · {rec.mode === 'live' ? 'Live: both sides confirm each point' : 'Quick: confirm at the end'}</Dim>
      {rec.mySide && <Dim>You captain Side {rec.mySide}</Dim>}
      <Body testID="status" style={{ color: s.status === 'disputed' ? colors.danger : colors.text }}>Status: {s.status}</Body>
      {err && <Body style={{ color: colors.danger }} testID="game-error">{err}</Body>}

      {s.status === 'lobby' && (
        <Card>
          <H2>Waiting for everyone to accept</H2>
          <Dim>A game only starts, counts and can affect ratings once every player has said yes.</Dim>
          {[...rec.players.A, ...rec.players.B].map((p) => (
            <Body key={p.id} testID={`seat-${p.id}`}>{p.accepted ? '✓' : '…'} {p.name}</Body>
          ))}
          {iAmSeated && !myAccepted && (
            <Row>
              <Button title="Accept game" testID="accept-game" onPress={() => act(() => backend.acceptGame(rec.id))} />
              <Button title="Decline" kind="danger" testID="decline-game" onPress={() => act(() => backend.declineGame(rec.id))} />
            </Row>
          )}
          {iAmSeated && myAccepted && <Dim>You accepted. Waiting for the others…</Dim>}
        </Card>
      )}

      {s.status === 'disputed' && (
        <Card>
          <H2>Game frozen: dispute</H2>
          <Dim>{s.dispute?.reason}. Both sides must enter the same score to continue, or void the game.</Dim>
          <Row>
            <TextInput testID="res-a" value={quickA} onChangeText={setQuickA} placeholder="Score A" keyboardType="number-pad" placeholderTextColor={colors.dim} style={input} />
            <TextInput testID="res-b" value={quickB} onChangeText={setQuickB} placeholder="Score B" keyboardType="number-pad" placeholderTextColor={colors.dim} style={input} />
          </Row>
          <Row>
            {sides.filter(can).map((x) => (
              <Button key={x} title={`Side ${x} agrees`} testID={`resolve-${x}`} onPress={() => dispatch({ type: 'resolve_dispute', side: x, score: quickScore })} />
            ))}
            <Button title={voidLabel} kind="danger" testID="void" onPress={() => dispatch({ type: 'void', side: me })} />
          </Row>
        </Card>
      )}

      {s.status === 'active' && rec.mode === 'live' && (
        <Card>
          {s.pending ? (
            <>
              <H2>Side {s.pending.by} claims {s.pending.points}</H2>
              {can(otherSide(s.pending.by)) ? (
                <Row>
                  <Button title={`Side ${otherSide(s.pending.by)} confirms`} testID="confirm-point" onPress={() => dispatch({ type: 'confirm_point', side: otherSide(s.pending!.by) })} />
                  <Button title="Dispute" kind="danger" testID="dispute" onPress={() => dispatch({ type: 'dispute', side: otherSide(s.pending!.by), reason: 'Point disputed' })} />
                </Row>
              ) : (
                waiting(otherSide(s.pending.by))
              )}
            </>
          ) : (
            sides.filter(can).map((x) => (
              <View key={x} style={{ gap: 8 }}>
                <Body>{label(x)}</Body>
                {rec.players[x].length > 1 && (
                  <Row>
                    <Dim>Who scored? (optional)</Dim>
                    {rec.players[x].map((p) => (
                      <Chip key={p.id} label={p.name} testID={`scorer-${x}-${p.id}`} active={scorer[x] === p.id} onPress={() => setScorer((c) => ({ ...c, [x]: c[x] === p.id ? null : p.id }))} />
                    ))}
                  </Row>
                )}
                <Row>
                  {allowedPoints(preset).map((pts) => (
                    <Button
                      key={pts}
                      title={`+${pts}`}
                      testID={`claim-${x}-${pts}`}
                      onPress={() => {
                        // A one-player team has an obvious scorer; for bigger teams we only record it when the captain says so.
                        const who = rec.players[x].length === 1 ? rec.players[x][0]!.id : scorer[x];
                        setScorer((c) => ({ ...c, [x]: null }));
                        void dispatch({ type: 'claim_point', side: x, points: pts, ...(who ? { scorer: who } : {}) });
                      }}
                    />
                  ))}
                </Row>
              </View>
            ))
          )}
        </Card>
      )}

      {s.status === 'active' && rec.mode === 'quick' && (
        <Card>
          {s.proposed ? (
            <>
              <H2>Side {s.proposed.by} proposes {s.proposed.score.A}-{s.proposed.score.B}</H2>
              {can(otherSide(s.proposed.by)) ? (
                <Row>
                  <Button title={`Side ${otherSide(s.proposed.by)} confirms`} testID="confirm-proposed" onPress={() => dispatch({ type: 'confirm_proposed', side: otherSide(s.proposed!.by) })} />
                  <Button title="Dispute" kind="danger" testID="dispute" onPress={() => dispatch({ type: 'dispute', side: otherSide(s.proposed!.by), reason: 'Final score disputed' })} />
                </Row>
              ) : (
                waiting(otherSide(s.proposed.by))
              )}
            </>
          ) : (
            <>
              <H2>Enter the final score</H2>
              <Row>
                <TextInput testID="quick-a" value={quickA} onChangeText={setQuickA} placeholder="Side A" keyboardType="number-pad" placeholderTextColor={colors.dim} style={input} />
                <TextInput testID="quick-b" value={quickB} onChangeText={setQuickB} placeholder="Side B" keyboardType="number-pad" placeholderTextColor={colors.dim} style={input} />
              </Row>
              <Button title={`Side ${me} proposes`} testID="propose" onPress={() => dispatch({ type: 'propose_final', side: me, score: quickScore })} />
            </>
          )}
        </Card>
      )}

      {s.status === 'awaiting_final' && (
        <Card>
          <H2>Confirm the final score {s.score.A}-{s.score.B}</H2>
          <Row>
            {sides.filter(can).map((x) => (
              <Button key={x} title={s.finalConfirmed[x] ? `Side ${x} confirmed` : `Side ${x} confirms`} disabled={s.finalConfirmed[x]} testID={`final-${x}`} onPress={() => dispatch({ type: 'confirm_final', side: x })} />
            ))}
            <Button title="Dispute" kind="danger" testID="dispute-final" onPress={() => dispatch({ type: 'dispute', side: me, reason: 'Final score disputed' })} />
          </Row>
          {rec.mySide && s.finalConfirmed[rec.mySide] && waiting(otherSide(rec.mySide))}
        </Card>
      )}

      {s.status === 'final' && (
        <Card>
          <H2>Final: {s.score.A}-{s.score.B}</H2>
          <Body testID="rating-line">{rec.outcome?.ratingLine}</Body>
          <Body testID="gold-award">+{rec.outcome?.goldAwarded ?? 0} Royalty Bucks</Body>
          <H2>Rate this game</H2>
          <Row>
            {[1, 2, 3, 4, 5].map((n) => (
              <Chip key={n} label={`${n}★`} testID={`stars-${n}`} active={rec.feedback?.gameRating === n} onPress={async () => { await backend.submitFeedback(rec.id, n); setRec(await backend.getGame(rec.id)); }} />
            ))}
          </Row>
          {everyone.map((p) => (
            <Row key={p.id}>
              <Body>Rate {p.name}</Body>
              {[1, 2, 3, 4, 5].map((n) => (
                <Chip key={n} label={`${n}★`} testID={`rate-${p.id}-${n}`} active={rated[p.id] === n} onPress={async () => { await backend.ratePlayer(rec.id, p.id, n); setRated((r) => ({ ...r, [p.id]: n })); }} />
              ))}
            </Row>
          ))}
          {!watching && <Button title="Watch replay" kind="ghost" testID="watch-replay" onPress={() => setWatching(true)} />}
          <Button title="Done" onPress={() => router.replace('/')} />
        </Card>
      )}
      {s.status === 'voided' && <Card><Body>Game voided. No rating or Royalty Bucks.</Body><Button title="Done" onPress={() => router.replace('/')} /></Card>}
    </Screen>
  );
}
