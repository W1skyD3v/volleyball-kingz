import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

/** Three complete looks for the same app. Night Court is the approved design; the others change colour, corner shape and weight. */
export type ThemeName = 'night' | 'street' | 'royal';
interface Tokens {
  bg: string; card: string; card2: string; text: string; dim: string; gold: string; goldBg: string; onAccent: string;
  danger: string; ok: string; okBg: string; line: string; privateFg: string; privateBg: string;
  rare: string; epic: string; common: string;
  radiusCard: number; radiusBtn: number; radiusChip: number; borderW: number; light: boolean;
}
export const THEMES: Record<ThemeName, { label: string; blurb: string; tokens: Tokens }> = {
  night: {
    label: 'Night Court',
    blurb: 'Dark gym, gold lights',
    tokens: { bg: '#0c0c0e', card: '#17171b', card2: '#1f1f25', text: '#f5f3ee', dim: '#a3a1ab', gold: '#f5b301', goldBg: '#2a2108', onAccent: '#111111', danger: '#ef4444', ok: '#3ddc84', okBg: '#10281a', line: '#2b2b33', privateFg: '#a78bfa', privateBg: '#1c1a2e', rare: '#60a5fa', epic: '#c084fc', common: '#a3a1ab', radiusCard: 16, radiusBtn: 12, radiusChip: 999, borderW: 1, light: false },
  },
  street: {
    label: 'Street Light',
    blurb: 'Daylight blacktop, bold edges',
    tokens: { bg: '#f4f1ea', card: '#ffffff', card2: '#ece8df', text: '#15130f', dim: '#57524a', gold: '#b93c0a', goldBg: '#fde8d8', onAccent: '#ffffff', danger: '#b91c1c', ok: '#166534', okBg: '#dcfce7', line: '#cfc8b8', privateFg: '#5b21b6', privateBg: '#ede9fe', rare: '#1d4ed8', epic: '#7e22ce', common: '#57524a', radiusCard: 6, radiusBtn: 6, radiusChip: 6, borderW: 2, light: true },
  },
  royal: {
    label: 'Royal Arena',
    blurb: 'Purple night, crown gold',
    tokens: { bg: '#0f0a24', card: '#1a1338', card2: '#251b4d', text: '#f3efff', dim: '#b3a8d9', gold: '#ffc83d', goldBg: '#3a2a08', onAccent: '#1a1338', danger: '#f87171', ok: '#4ade80', okBg: '#12301f', line: '#3a2f6b', privateFg: '#c4b5fd', privateBg: '#2a2058', rare: '#7dd3fc', epic: '#e9a8ff', common: '#b3a8d9', radiusCard: 24, radiusBtn: 16, radiusChip: 999, borderW: 1, light: false },
  },
};

/** Live tokens. `applyTheme` overwrites these in place, then the app remounts its screens so every style is rebuilt. */
export const colors: Omit<Tokens, 'radiusCard' | 'radiusBtn' | 'radiusChip' | 'borderW' | 'light'> = { ...THEMES.night.tokens };
export const shape = { radiusCard: 16, radiusBtn: 12, radiusChip: 999, borderW: 1, light: false };

export function applyTheme(name: ThemeName): void {
  const t = THEMES[name].tokens;
  Object.assign(colors, t);
  Object.assign(shape, { radiusCard: t.radiusCard, radiusBtn: t.radiusBtn, radiusChip: t.radiusChip, borderW: t.borderW, light: t.light });
  s = build();
}

/** Loaded in app/_layout.tsx. Until then (and in tests) the platform font is used. */
export const fonts = {
  display: 'BarlowCondensed_800ExtraBold',
  displayMid: 'BarlowCondensed_700Bold',
  body: 'Barlow_400Regular',
  bodyBold: 'Barlow_600SemiBold',
};

export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      {children}
    </ScrollView>
  );
}
export const H1 = ({ children }: { children: React.ReactNode }) => (
  <Text accessibilityRole="header" style={s.h1}>
    {children}
  </Text>
);
export const H2 = ({ children }: { children: React.ReactNode }) => (
  <Text accessibilityRole="header" style={s.h2}>
    {children}
  </Text>
);
/** Small uppercase section label ("TYPE", "PLAY TO"). */
export const Label = ({ children }: { children: React.ReactNode }) => <Text style={s.label}>{children}</Text>;
export const Dim = ({ children }: { children: React.ReactNode }) => <Text style={s.dim}>{children}</Text>;
export const Body = ({ children, style, testID }: { children: React.ReactNode; style?: TextStyle; testID?: string }) => (
  <Text style={[s.body, style]} testID={testID}>
    {children}
  </Text>
);

/** "BASKETBALL KINGZ" wordmark. */
export const Brand = () => <Text style={s.brand}>BASKETBALL KINGZ</Text>;

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

type BadgeKind = 'live' | 'quiet' | 'ranked' | 'casual' | 'private';
const badgeColors = (k: BadgeKind): { bg: string; fg: string } =>
  ({
    live: { bg: colors.okBg, fg: colors.ok },
    quiet: { bg: colors.card2, fg: colors.dim },
    ranked: { bg: colors.goldBg, fg: colors.gold },
    casual: { bg: colors.card2, fg: colors.dim },
    private: { bg: colors.privateBg, fg: colors.privateFg },
  })[k];
export function Badge({ children, kind = 'quiet', testID }: { children: React.ReactNode; kind?: BadgeKind; testID?: string }) {
  const c = badgeColors(kind);
  return (
    <View style={[s.badge, { backgroundColor: c.bg }]}>
      {kind === 'live' ? <View style={[s.dot, { backgroundColor: c.fg }]} /> : null}
      <Text testID={testID} style={[s.badgeText, { color: c.fg }]}>
        {children}
      </Text>
    </View>
  );
}

export function Button({ title, onPress, kind = 'primary', disabled, testID, accessibilityLabel }: { title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; testID?: string; accessibilityLabel?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.btn, kind === 'ghost' && s.btnGhost, kind === 'danger' && s.btnDanger, disabled && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}
    >
      <Text style={[s.btnText, kind === 'ghost' && { color: colors.text }, kind === 'danger' && { color: '#ffffff' }]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, active, onPress, testID, fill }: { label: string; active?: boolean; onPress: () => void; testID?: string; fill?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!active }} testID={testID} onPress={onPress} style={[s.chip, active && s.chipOn, fill && { flex: 1, alignItems: 'center', paddingHorizontal: 4 }]}>
      <Text style={[s.chipText, active && { color: colors.onAccent, fontFamily: fonts.bodyBold }]}>{label}</Text>
    </Pressable>
  );
}
export const Row = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => <View style={[s.row, style]}>{children}</View>;

/** Big scoreboard-style number. */
export function BigNumber({ value, size = 56, color = colors.text, testID }: { value: string | number; size?: number; color?: string; testID?: string }) {
  return (
    <Text testID={testID} style={{ fontFamily: fonts.display, fontSize: size, lineHeight: size * 1.02, color }}>
      {value}
    </Text>
  );
}

function build() {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 14, paddingBottom: 56 },
  brand: { color: colors.gold, fontFamily: fonts.display, fontSize: 18, letterSpacing: 1.6 },
  h1: { color: colors.text, fontFamily: fonts.display, fontSize: 40, lineHeight: 42, textTransform: 'uppercase', fontWeight: '800' },
  h2: { color: colors.text, fontFamily: fonts.displayMid, fontSize: 24, lineHeight: 28, textTransform: 'uppercase', fontWeight: '700' },
  label: { color: colors.dim, fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase' },
  dim: { color: colors.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  body: { color: colors.text, fontFamily: fonts.body, fontSize: 16, lineHeight: 22 },
  card: { backgroundColor: colors.card, borderRadius: shape.radiusCard, padding: 16, gap: 10, borderWidth: shape.borderW, borderColor: colors.line },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, alignSelf: 'flex-start' },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 13, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  btn: { backgroundColor: colors.gold, minHeight: 48, paddingVertical: 12, paddingHorizontal: 18, borderRadius: shape.radiusBtn, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: shape.borderW, borderColor: colors.line },
  btnDanger: { backgroundColor: colors.danger },
  btnText: { color: colors.onAccent, fontFamily: fonts.bodyBold, fontWeight: '700', fontSize: 16 },
  chip: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 16, borderRadius: shape.radiusChip, borderWidth: shape.borderW, borderColor: colors.line, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.dim, fontFamily: fonts.body, fontSize: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
});
}
let s = build();
