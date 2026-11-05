import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { THEMES, applyTheme, type ThemeName } from '../ui/kit';

const KEY = 'vk-theme';
export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];
const isTheme = (v: unknown): v is ThemeName => typeof v === 'string' && v in THEMES;

/** The saved choice (web: ?theme=name, then localStorage). Storage can be blocked or empty, so every read is guarded. */
export function initialTheme(): ThemeName {
  try {
    const g = globalThis as { location?: { search?: string }; localStorage?: { getItem(k: string): string | null } };
    const fromUrl = new URLSearchParams(g.location?.search ?? '').get('theme');
    if (isTheme(fromUrl)) return fromUrl;
    const saved = g.localStorage?.getItem(KEY);
    if (isTheme(saved)) return saved;
  } catch {
    /* no storage: use the default */
  }
  return 'night';
}

interface Ctx {
  theme: ThemeName;
  setTheme(t: ThemeName): void;
}
const ThemeCtx = createContext<Ctx>({ theme: 'night', setTheme: () => undefined });

/** Applies the theme before any child renders; changing it remounts the screens so every style is rebuilt. */
export function ThemeProvider({ children }: { children: (theme: ThemeName) => React.ReactNode }) {
  const [theme, set] = useState<ThemeName>(() => {
    const t = initialTheme();
    applyTheme(t);
    return t;
  });
  const setTheme = useCallback((t: ThemeName) => {
    applyTheme(t);
    try {
      (globalThis as { localStorage?: { setItem(k: string, v: string): void } }).localStorage?.setItem(KEY, t);
    } catch {
      /* not saved; still applied for this visit */
    }
    set(t);
  }, []);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeCtx.Provider value={value}>{children(theme)}</ThemeCtx.Provider>;
}

export const useTheme = (): Ctx => useContext(ThemeCtx);
