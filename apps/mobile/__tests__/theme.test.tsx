import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { THEMES, Button, Chip, applyTheme, colors, shape, type ThemeName } from '../src/ui/kit';
import { ThemeProvider, initialTheme, useTheme } from '../src/state/theme';

afterEach(() => applyTheme('night'));

const luminance = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('app styles (themes)', () => {
  it.each(Object.keys(THEMES) as ThemeName[])('%s: every text colour is readable on its surface (WCAG AA 4.5:1)', (name) => {
    const t = THEMES[name].tokens;
    const failing: string[] = [];
    for (const [fg, bg, what] of [[t.text, t.bg, 'text on page'], [t.text, t.card, 'text on card'], [t.dim, t.bg, 'dim on page'], [t.dim, t.card, 'dim on card'], [t.onAccent, t.gold, 'label on accent button'], [t.gold, t.goldBg, 'accent badge'], [t.ok, t.okBg, 'live badge'], [t.dim, t.card2, 'dim on chip'], [t.gold, t.bg, 'accent on page'], [t.gold, t.card, 'accent on card'], [t.privateFg, t.privateBg, 'private badge'], [t.rare, t.card, 'rare label'], [t.epic, t.card, 'epic label']] as const) {
      if (contrast(fg, bg) < 4.5) failing.push(`${what} ${fg} on ${bg} = ${contrast(fg, bg).toFixed(2)}`);
    }
    expect(failing).toEqual([]);
  });

  it('applying a theme changes the live colours and the shape of buttons and chips', () => {
    render(<Button title="Go" onPress={() => undefined} testID="b" />);
    const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);
    expect(flat('b').backgroundColor).toBe(THEMES.night.tokens.gold);
    applyTheme('street');
    expect(colors.bg).toBe(THEMES.street.tokens.bg);
    expect(shape.radiusBtn).toBe(6);
    screen.unmount();
    render(<Button title="Go" onPress={() => undefined} testID="b" />);
    expect(flat('b').backgroundColor).toBe(THEMES.street.tokens.gold);
    expect(flat('b').borderRadius).toBe(6);
  });

  it('the three looks really differ (colours, corners, borders)', () => {
    const sig = (n: ThemeName) => JSON.stringify([THEMES[n].tokens.bg, THEMES[n].tokens.gold, THEMES[n].tokens.radiusCard, THEMES[n].tokens.borderW]);
    expect(new Set(['night', 'street', 'royal'].map((n) => sig(n as ThemeName))).size).toBe(3);
  });

  it('the picker switches the theme and remounts with the new look; the saved choice survives a reload', () => {
    const store: Record<string, string> = {};
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
    function Picker() {
      const { theme, setTheme } = useTheme();
      return <Chip label={`now ${theme}`} testID="pick" onPress={() => setTheme(theme === 'night' ? 'royal' : 'night')} />;
    }
    render(<ThemeProvider>{() => <Picker />}</ThemeProvider>);
    expect(screen.getByText('now night')).toBeTruthy();
    act(() => { fireEvent.press(screen.getByTestId('pick')); });
    expect(screen.getByText('now royal')).toBeTruthy();
    expect(colors.bg).toBe(THEMES.royal.tokens.bg);
    expect(store['vk-theme']).toBe('royal');
    expect(initialTheme()).toBe('royal');
    store['vk-theme'] = '<script>';
    expect(initialTheme()).toBe('night'); // junk in storage is ignored
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(initialTheme()).toBe('night'); // no storage at all is fine
  });
});
