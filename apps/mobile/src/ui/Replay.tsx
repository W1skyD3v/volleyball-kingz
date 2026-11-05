import React, { memo, useEffect, useMemo, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { CAMERA_W, STAGE_H, actorsSvg, cameraX, courtSvg, crowdRowSvg, frameAt, hoopsSvg, type Appearance, type StageFrame, type Styles } from '@vk/avatar';
import { buildReplay, itemById, wornVariants, type GameState, type Side } from '@vk/core';
import type { TeamPlayer } from './teams';
import { Body, Button, H2, Row, colors } from './kit';

const FRAME_MS = 66; // about 15 frames a second: sprite-animation pace, light on the phone
const BALL_COLOR: Record<string, string> = { classic: '#f97316', neon: '#a3e635', gold: '#f5b301' };

const Static = memo(function Static({ xml, w, h, vb }: { xml: string; w: number; h: number; vb: string }) {
  return <SvgXml xml={xml} width={w} height={h} viewBox={vb} />;
});

/** The animated scene for one frame: court, crowd, hoops and sprites, with a camera that follows the shooter. */
export function Stage({ frame, look, ballColor, seed, testID, children }: { frame: StageFrame; look: (key: string) => Appearance; ballColor?: string; seed: string; testID?: string; children?: React.ReactNode }) {
  const { width: screenW } = useWindowDimensions();
  const w = Math.min(560, Math.max(280, screenW - 40));
  const h = (w * STAGE_H) / CAMERA_W;
  const court = useMemo(() => courtSvg(), []);
  const rows = useMemo(() => [0, 1, 2].map((i) => crowdRowSvg(i, seed)), [seed]);
  const rowsUp = useMemo(() => [0, 1, 2].map((i) => crowdRowSvg(i, seed, true)), [seed]);
  const k = w / CAMERA_W;
  const vb = `${cameraX(frame).toFixed(1)} 0 ${CAMERA_W} ${STAGE_H}`;
  const bob = (i: number) => -Math.round(frame.crowd * [4, 7, 10][i]! * k * 2);
  return (
    <View testID={testID} style={{ width: w, height: h, alignSelf: 'center', borderRadius: 16, overflow: 'hidden', backgroundColor: '#0b0b10' }}>
      <View style={{ position: 'absolute' }}><Static xml={court} w={w} h={h} vb={vb} /></View>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ position: 'absolute', transform: [{ translateY: bob(i) }] }}>
          <Static xml={frame.crowd > 0.6 ? rowsUp[i]! : rows[i]!} w={w} h={h} vb={vb} />
        </View>
      ))}
      <View style={{ position: 'absolute' }}><SvgXml xml={hoopsSvg(frame)} width={w} height={h} viewBox={vb} /></View>
      <View style={{ position: 'absolute' }}><SvgXml xml={actorsSvg(frame, look, ballColor)} width={w} height={h} viewBox={vb} /></View>
      {children}
    </View>
  );
}

interface Props {
  state: GameState;
  mySide: Side;
  teams: Record<Side, TeamPlayer[]>;
  myName?: string;
  oppName?: string;
  /** For tests and previews. */
  autoPlay?: boolean;
  onClose?: () => void;
}

/** Instant replay: a 2D re-enactment of the game. Each made basket is about 7 seconds, whatever the real game took. */
export function Replay({ state, mySide, teams, myName = 'Your team', oppName = 'Them', autoPlay = true, onClose }: Props) {
  const replay = useMemo(() => buildReplay(state), [state]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const [speed, setSpeed] = useState(1);
  const total = replay.durationMs;

  useEffect(() => {
    setT(0);
    setPlaying(autoPlay);
  }, [replay, autoPlay]);
  useEffect(() => {
    if (!playing || !replay.available) return;
    const id = setInterval(() => setT((x) => Math.min(total, x + FRAME_MS * speed)), FRAME_MS);
    return () => clearInterval(id);
  }, [playing, speed, total, replay.available]);
  useEffect(() => {
    if (t >= total && total > 0) setPlaying(false);
  }, [t, total]);

  const seed = useMemo(() => teams.A.map((p) => p.id).join('') + teams.B.map((p) => p.id).join(''), [teams]);

  if (!replay.available) {
    return (
      <View>
        <H2>Replay</H2>
        <Body testID="replay-note" style={{ color: colors.dim }}>{replay.note}</Body>
        {onClose ? <Button title="Close" kind="ghost" testID="replay-close" onPress={onClose} /> : null}
      </View>
    );
  }

  // which step are we in, and how far into it
  let idx = 0;
  for (let i = 0; i < replay.steps.length; i++) if (t >= replay.steps[i]!.t) idx = i;
  const step = replay.steps[idx]!;
  const finished = t >= total;
  const local = Math.min(step.durationMs, t - step.t);
  const offense = teams[step.side];
  const defense = teams[step.side === 'A' ? 'B' : 'A'];
  const shooterP = (step.scorer && offense.find((p) => p.id === step.scorer)) || offense[0]!;
  const passerP = offense.find((p) => p.id !== shooterP.id);
  const cast: Record<string, TeamPlayer | undefined> = { shooter: shooterP, passer: passerP, defender: defense[0], defender2: defense[1] };
  const sv = wornVariants(shooterP.loadout);
  const styles: Partial<Styles> = { dunk: sv.dunk, shot: sv.shot, dribble: sv.dribble, celebration: sv.celebration, pass: passerP ? wornVariants(passerP.loadout).pass : sv.pass };
  const frame = frameAt(step, { teamSize: offense.length, styles }, local);
  const look = (key: string): Appearance => {
    const p = cast[key] ?? shooterP;
    return { config: p.config, worn: wornVariants(p.loadout) };
  };
  const ballColor = BALL_COLOR[itemById(shooterP.loadout.ball ?? '')?.variant ?? 'classic'];
  const madeNow = frame.hoop.made;
  const shown = madeNow ? step : idx > 0 ? replay.steps[idx - 1]! : null;
  const sa = finished ? replay.finalScore.A : (shown?.scoreA ?? 0);
  const sb = finished ? replay.finalScore.B : (shown?.scoreB ?? 0);
  const mine = mySide === 'A' ? sa : sb;
  const theirs = mySide === 'A' ? sb : sa;
  const iWon = replay.winner === mySide;
  const who = step.scorer ? (shooterP.name ?? '') : step.side === mySide ? myName : oppName;
  const caption = finished ? (replay.winner ? (iWon ? 'You won!' : `${oppName} won`) : 'Final') : `${frame.caption}${step.kind === 'adjust' ? '' : ` · ${who}`}`;

  return (
    <View>
      <H2>Replay</H2>
      <Stage frame={frame} look={look} ballColor={ballColor} seed={seed}>
        <View pointerEvents="none" style={{ position: 'absolute', top: 6, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{ backgroundColor: 'rgba(12,12,14,0.82)', paddingHorizontal: 14, paddingVertical: 4, borderRadius: 999 }}>
            <Body testID="replay-score" style={{ fontFamily: 'BarlowCondensed_800ExtraBold', fontSize: 20, color: colors.text }}>{myName} {mine} : {theirs} {oppName}</Body>
          </View>
        </View>
      </Stage>
      <Body testID="replay-step" style={{ color: colors.dim, textAlign: 'center', marginTop: 6 }}>{caption}</Body>
      <Row style={{ justifyContent: 'center' }}>
        <Button title={playing ? 'Pause' : finished ? 'Watch again' : 'Play'} kind="ghost" testID="replay-again" onPress={() => { if (finished) setT(0); setPlaying(!playing || finished); }} />
        <Button title={speed === 1 ? '2x' : '1x'} kind="ghost" testID="replay-speed" onPress={() => setSpeed(speed === 1 ? 2 : 1)} />
        <Button title="Skip" kind="ghost" testID="replay-skip" onPress={() => { setT(total); setPlaying(false); }} />
        {onClose ? <Button title="Close" kind="ghost" testID="replay-close" onPress={onClose} /> : null}
      </Row>
    </View>
  );
}
