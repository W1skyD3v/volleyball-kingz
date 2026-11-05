import React, { useEffect, useMemo, useState } from 'react';
import { frameAt, type Appearance, type AvatarConfig } from '@vk/avatar';
import { REPLAY_STEP_MS, itemById, shotFor, wornVariants, type Loadout, type ReplayStep } from '@vk/core';
import { Stage } from './Replay';

const FRAME_MS = 66;

/** A looping 7-second sample of one animation style (dunk, three, dribble, pass or celebration), shown in the Closet. */
export function StylePreview({ itemId, config, loadout }: { itemId: string; config: AvatarConfig; loadout: Loadout }) {
  const item = itemById(itemId);
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => (x + FRAME_MS) % REPLAY_STEP_MS), FRAME_MS);
    return () => clearInterval(id);
  }, []);
  const step: ReplayStep = useMemo(() => {
    const three = item?.slot === 'shot';
    return { t: 0, durationMs: REPLAY_STEP_MS, side: 'A', points: three ? 2 : 1, shot: shotFor(three ? 2 : 1), scoreA: 0, scoreB: 0, kind: 'basket' };
  }, [item]);
  if (!item) return null;
  const mine = wornVariants(loadout);
  const styles = { dunk: mine.dunk, shot: mine.shot, dribble: mine.dribble, pass: mine.pass, celebration: mine.celebration, [item.slot]: item.variant };
  const frame = frameAt(step, { teamSize: item.slot === 'pass' ? 2 : 1, styles }, t);
  const other: AvatarConfig = { ...config, seed: 'sparring', jersey: { ...config.jersey, primary: '#3b82f6', secondary: '#f5f3ee', number: 8 }, shorts: { color: '#1e3a8a' } };
  const look = (key: string): Appearance => (key.startsWith('defender') ? { config: other, worn: {} } : { config, worn: wornVariants(loadout) });
  return <Stage testID="style-preview" frame={frame} look={look} seed="preview" />;
}
