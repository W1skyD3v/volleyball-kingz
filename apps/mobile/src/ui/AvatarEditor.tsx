import React from 'react';
import { BEARD_STYLES, HAIR_COLORS, HAIR_STYLES, SKIN_TONES, lookFromSeed, type AvatarConfig, type Look } from '@vk/avatar';
import type { Loadout } from '@vk/core';
import { Avatar } from './Avatar';
import { Button, Chip, Dim, H2, Label, Row, colors } from './kit';
import { Pressable, View } from 'react-native';

const PALETTE = ['#f5b301', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#ffffff', '#1b1b1b'];

function Swatches({ value, onPick, id, palette = PALETTE }: { value: string; onPick: (c: string) => void; id: string; palette?: readonly string[] }) {
  return (
    <Row style={{ gap: 0 }}>
      {palette.map((c) => (
        <Pressable key={c} accessibilityRole="button" accessibilityLabel={`${id} ${c}`} testID={`${id}-${c}`} onPress={() => onPick(c)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c, borderWidth: value === c ? 3 : 1, borderColor: value === c ? colors.gold : colors.line }} />
        </Pressable>
      ))}
    </Row>
  );
}

/** Free choices: face, colours, number. Styles and gear come from the Closet. Nothing here affects rating. */
export function AvatarEditor({ value, loadout, onChange }: { value: AvatarConfig; loadout?: Loadout; onChange: (a: AvatarConfig) => void }) {
  const set = (patch: Partial<AvatarConfig>) => onChange({ ...value, ...patch });
  const look: Look = value.look ?? lookFromSeed(value.seed);
  const setLook = (patch: Partial<Look>) => set({ look: { ...look, ...patch } });
  return (
    <>
      <Row style={{ justifyContent: 'center' }}>
        <Avatar config={value} loadout={loadout} size={190} />
      </Row>
      <Button title="Surprise me" kind="ghost" testID="avatar-reroll" onPress={() => { const seed = Math.random().toString(36).slice(2, 10); set({ seed, look: lookFromSeed(seed) }); }} />
      <H2>Face</H2>
      <Label>Skin</Label>
      <Swatches id="skin" value={SKIN_TONES[look.skin]!} palette={SKIN_TONES} onPick={(c) => setLook({ skin: SKIN_TONES.indexOf(c as (typeof SKIN_TONES)[number]) })} />
      <Label>Hair</Label>
      <Row>{HAIR_STYLES.map((h) => <Chip key={h} label={h} testID={`hair-${h}`} active={look.hair === h} onPress={() => setLook({ hair: h })} />)}</Row>
      <Swatches id="hair-color" value={HAIR_COLORS[look.hairColor]!} palette={HAIR_COLORS} onPick={(c) => setLook({ hairColor: HAIR_COLORS.indexOf(c as (typeof HAIR_COLORS)[number]) })} />
      <Label>Facial hair</Label>
      <Row>{BEARD_STYLES.map((b) => <Chip key={b} label={b} testID={`beard-${b}`} active={look.beard === b} onPress={() => setLook({ beard: b })} />)}</Row>
      <H2>Jersey</H2>
      <Dim>Main colour</Dim>
      <Swatches id="jersey-primary" value={value.jersey.primary} onPick={(c) => set({ jersey: { ...value.jersey, primary: c } })} />
      <Dim>Trim colour</Dim>
      <Swatches id="jersey-secondary" value={value.jersey.secondary} onPick={(c) => set({ jersey: { ...value.jersey, secondary: c } })} />
      <Row>
        <Button title="−" kind="ghost" testID="number-down" onPress={() => set({ jersey: { ...value.jersey, number: (value.jersey.number + 99) % 100 } })} />
        <Dim>Number {value.jersey.number}</Dim>
        <Button title="+" kind="ghost" testID="number-up" onPress={() => set({ jersey: { ...value.jersey, number: (value.jersey.number + 1) % 100 } })} />
      </Row>
      <H2>Shorts</H2>
      <Swatches id="shorts" value={value.shorts.color} onPick={(c) => set({ shorts: { color: c } })} />
      <H2>Shoes</H2>
      <Swatches id="shoes" value={value.shoes.color} onPick={(c) => set({ shoes: { ...value.shoes, color: c } })} />
    </>
  );
}
