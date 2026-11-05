import React from 'react';
import { SvgXml } from 'react-native-svg';
import { defaultAvatarConfig, renderAvatarSvg, type AvatarConfig } from '@vk/avatar';
import { wornVariants, type Loadout } from '@vk/core';

/** Never crashes on a bad config (another player's avatar is untrusted data): it falls back to a default look. */
export function safeAvatarSvg(config: AvatarConfig, loadout?: Loadout): string {
  const worn = loadout ? wornVariants(loadout) : {};
  try {
    return renderAvatarSvg(config, worn);
  } catch {
    return renderAvatarSvg(defaultAvatarConfig('fallback'), worn);
  }
}

export function Avatar({ config, loadout, size = 120 }: { config: AvatarConfig; loadout?: Loadout; size?: number }) {
  return <SvgXml xml={safeAvatarSvg(config, loadout)} width={size} height={size * 1.5} accessibilityLabel="Player avatar" accessibilityRole="image" />;
}
