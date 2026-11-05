import React, { useCallback, useState } from 'react';
import { CATALOG, OPTIONAL_SLOTS, SLOTS, priceOf, type CosmeticItem, type Slot } from '@vk/core';
import type { Closet } from '../../src/backend/types';
import { useApp } from '../../src/state/AppState';
import { Avatar } from '../../src/ui/Avatar';
import { StylePreview } from '../../src/ui/StylePreview';
import { LoadError } from '../../src/ui/LoadError';
import { useLoader } from '../../src/ui/useLoader';
import { Text, View } from 'react-native';
import { Body, Brand, Button, Card, Dim, H1, H2, Row, Screen, colors, fonts } from '../../src/ui/kit';

const rarityColor = (r: 'common' | 'rare' | 'epic' | 'legendary') => ({ common: colors.common, rare: colors.rare, epic: colors.epic, legendary: colors.gold })[r];
const ANIMATED = ['dunk', 'shot', 'dribble', 'pass', 'celebration'];
const SLOT_LABEL: Record<Slot, string> = { jersey: 'Jersey', shorts: 'Shorts', shoes: 'Shoes', headwear: 'Headwear', accessory: 'Accessories', ball: 'Ball', celebration: 'Celebration', dunk: 'Dunk style', shot: 'Three-point style', dribble: 'Dribble style', pass: 'Pass style' };
const ERRORS: Record<string, string> = {
  not_enough_gold: 'Not enough Royalty Bucks yet. Play games to earn more.',
  already_owned: 'You already own that.',
  premium_only: 'That one is not available yet.',
  not_owned: 'You do not own that yet.',
  unknown_item: 'That item is not in the shop.',
  cannot_empty: 'That slot cannot be empty.',
};

/** Build a Baller: wear what you own, spend earned Gold on the rest. Cosmetics only: nothing here changes rating. */
export default function ClosetScreen() {
  const { backend, profile, refreshProfile } = useApp();
  const [closet, setCloset] = useState<Closet | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => setCloset(await backend.getCloset()), [backend]);
  const { error, retry } = useLoader(load);

  async function run(fn: () => Promise<Closet>, ok: string) {
    try {
      setCloset(await fn());
      setMsg(ok);
      await refreshProfile();
    } catch (e) {
      setMsg(ERRORS[(e as Error).message] ?? 'Something went wrong. Try again.');
    }
  }

  if (!profile) return null;
  return (
    <Screen>
      <Brand />
      <H1>Build your Baller</H1>
      <LoadError error={error} onRetry={retry} />
      <Card>
        <Row style={{ justifyContent: 'center' }}>
          <Avatar config={profile.avatar} loadout={closet?.loadout} size={190} />
        </Row>
        <Body testID="closet-gold">Royalty Bucks: {closet?.gold ?? profile.goldEarned}</Body>
        <Dim>Royalty Bucks are earned by playing. King Credits (bought) are not available yet. Gear is cosmetic only and never changes your rating.</Dim>
        {msg ? <Body testID="closet-msg">{msg}</Body> : null}
      </Card>
      {SLOTS.map((slot) => {
        const items = CATALOG.filter((i) => i.slot === slot);
        return (
          <Card key={slot}>
            <H2>{SLOT_LABEL[slot]}</H2>
            {items.map((it) => (
              <ItemBlock key={it.id} item={it} closet={closet} profile={profile} onBuy={() => run(() => backend.buyItem(it.id), `Bought ${it.name}`)} onWear={() => run(() => backend.equipItem(it.id), `Wearing ${it.name}`)} />
            ))}
            {OPTIONAL_SLOTS.includes(slot) && closet?.loadout[slot] ? <Button title={`Take off ${SLOT_LABEL[slot].toLowerCase()}`} kind="ghost" testID={`unequip-${slot}`} onPress={() => void run(() => backend.unequipSlot(slot), 'Taken off')} /> : null}
          </Card>
        );
      })}
    </Screen>
  );
}

function ItemRow({ item, closet, onBuy, onWear }: { item: CosmeticItem; closet: Closet | null; onBuy: () => void; onWear: () => void }) {
  const owned = closet?.owned.includes(item.id) ?? false;
  const worn = closet?.loadout[item.slot] === item.id;
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Body testID={`item-${item.id}`} style={worn ? { color: colors.gold } : undefined}>
          {item.name} {worn ? '(wearing)' : ''}
        </Body>
        <Text style={{ color: rarityColor(item.rarity), fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', fontFamily: fonts.bodyBold }}>{item.rarity}</Text>
      </View>
      {worn ? null : owned ? (
        <Button title="Wear" kind="ghost" testID={`wear-${item.id}`} onPress={onWear} />
      ) : item.premiumOnly ? (
        <Dim>Premium, coming later</Dim>
      ) : (
        <Button title={`${priceOf(item)} Bucks`} kind={(closet?.gold ?? 0) >= priceOf(item) ? 'primary' : 'ghost'} testID={`buy-${item.id}`} onPress={onBuy} />
      )}
    </Row>
  );
}

/** An item row; animation styles also get a Preview that plays the move before you spend Gold on it. */
function ItemBlock(props: { item: CosmeticItem; closet: Closet | null; profile: { avatar: import('@vk/avatar').AvatarConfig }; onBuy: () => void; onWear: () => void }) {
  const [open, setOpen] = useState(false);
  const { item, closet, profile } = props;
  return (
    <View style={{ gap: 8 }}>
      <ItemRow item={item} closet={closet} onBuy={props.onBuy} onWear={props.onWear} />
      {ANIMATED.includes(item.slot) && (
        <>
          <Button title={open ? 'Hide preview' : 'Preview'} kind="ghost" testID={`preview-${item.id}`} onPress={() => setOpen(!open)} />
          {open && <StylePreview itemId={item.id} config={profile.avatar} loadout={closet?.loadout ?? {}} />}
        </>
      )}
    </View>
  );
}
