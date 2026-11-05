import { defaultAvatarConfig, lookFromSeed, type AvatarConfig } from '@vk/avatar';
import { defaultLoadout, type Loadout, type Side } from '@vk/core';
import type { GameRecord, MyProfile } from '../backend/types';

export interface TeamPlayer {
  id: string;
  name: string;
  config: AvatarConfig;
  loadout: Loadout;
}

const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

/**
 * Who the replay and the live court show. You are drawn with your own avatar and gear. Other players get a look derived
 * from their name and the starter gear until the backend can hand over their real avatars. Teams wear different colours.
 */
export function teamsFor(rec: GameRecord, me: MyProfile | null, myLoadout: Loadout): Record<Side, TeamPlayer[]> {
  const mySide: Side = rec.mySide ?? 'A';
  const mine = me?.avatar.jersey.primary ?? '#f5b301';
  const other = mine.toLowerCase() === '#3b82f6' ? { primary: '#ef4444', secondary: '#f5f3ee', short: '#7f1d1d' } : { primary: '#3b82f6', secondary: '#f5f3ee', short: '#1e3a8a' };
  const build = (side: Side): TeamPlayer[] =>
    rec.players[side].map((p) => {
      if (me && p.id === me.id) return { id: p.id, name: p.name, config: me.avatar, loadout: myLoadout };
      const base = defaultAvatarConfig(p.name);
      const own = side === mySide;
      return {
        id: p.id,
        name: p.name,
        loadout: defaultLoadout(),
        config: {
          ...base,
          look: lookFromSeed(p.name),
          jersey: { style: 'classic', primary: own ? mine : other.primary, secondary: own ? (me?.avatar.jersey.secondary ?? '#1b1b1b') : other.secondary, number: hash(p.name) % 100 },
          shorts: { color: own ? (me?.avatar.shorts.color ?? '#1b1b1b') : other.short },
        },
      };
    });
  return { A: build('A'), B: build('B') };
}
