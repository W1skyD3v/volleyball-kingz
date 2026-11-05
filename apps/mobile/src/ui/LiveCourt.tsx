import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { CAMERA_W, FLOOR_Y, STAGE_H, actorsSvg, courtSvg, hoopsSvg, type Appearance, type StageFrame } from '@vk/avatar';
import { wornVariants, type Side } from '@vk/core';
import type { TeamPlayer } from './teams';

const VB = `130 130 ${CAMERA_W} ${STAGE_H - 130}`; // crop the empty stands: the live strip is a short band
const Static = memo(function Static({ xml, w, h }: { xml: string; w: number; h: number }) {
  return <SvgXml xml={xml} width={w} height={h} viewBox={VB} />;
});

/**
 * The real-time view while a game is being played: the court, a sprite for each team, and a hop for whoever just scored.
 * No crowd here (that is in the replay). Costs almost nothing: one small timer, two sprites.
 */
export function LiveCourt({ teams, score, active }: { teams: Record<Side, TeamPlayer[]>; score: Record<Side, number>; active: boolean }) {
  const { width: screenW } = useWindowDimensions();
  const w = Math.min(560, Math.max(280, screenW - 40));
  const h = (w * (STAGE_H - 130)) / CAMERA_W;
  const [tick, setTick] = useState(0);
  const [cheer, setCheer] = useState<{ side: Side; until: number } | null>(null);
  const prev = useRef(score);
  const court = useMemo(() => courtSvg(), []);

  useEffect(() => {
    if (score.A > prev.current.A) setCheer({ side: 'A', until: tick + 12 });
    else if (score.B > prev.current.B) setCheer({ side: 'B', until: tick + 12 });
    prev.current = score;
  }, [score.A, score.B]);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((x) => x + 1), 100);
    return () => clearInterval(id);
  }, [active]);

  const sprite = (side: Side): StageFrame['actors'][number] => {
    const cheering = cheer && cheer.side === side && tick < cheer.until;
    const bob = Math.sin((tick + (side === 'A' ? 0 : 3)) * 0.5);
    return {
      key: side,
      team: side,
      role: 'shooter',
      x: side === 'A' ? 250 : 470,
      y: FLOOR_Y,
      pose: cheering
        ? { armL: { s: 160, f: 170 }, armR: { s: 160, f: 170 }, dy: -Math.abs(Math.sin(tick * 0.9)) * 26, legL: { a: 10 }, legR: { a: 10 } }
        : { dy: bob * 2.5, armL: { s: 10 + bob * 2, f: 6 }, armR: { s: 10 - bob * 2, f: 6 }, legL: { a: 6 }, legR: { a: 6 } },
    };
  };
  const frame: StageFrame = { actors: [sprite('A'), sprite('B')], ball: { x: 0, y: 0, visible: false, behind: false }, hoop: { side: 'R', shake: 0, made: false }, popup: null, crowd: 0, caption: '' };
  const look = (key: string): Appearance => {
    const p = teams[key as Side][0]!;
    return { config: p.config, worn: wornVariants(p.loadout) };
  };
  return (
    <View testID="live-court" style={{ width: w, height: h, alignSelf: 'center', borderRadius: 16, overflow: 'hidden', backgroundColor: '#0b0b10' }}>
      <View style={{ position: 'absolute' }}><Static xml={court} w={w} h={h} /></View>
      <View style={{ position: 'absolute' }}><SvgXml xml={hoopsSvg(frame)} width={w} height={h} viewBox={VB} /></View>
      <View style={{ position: 'absolute' }}><SvgXml xml={actorsSvg(frame, look)} width={w} height={h} viewBox={VB} /></View>
    </View>
  );
}
