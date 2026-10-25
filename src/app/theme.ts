import { useCallback, useEffect, useState } from 'react';

/** "system" follows the phone's Light/Dark setting. */
export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** Kept in localStorage on purpose: it belongs to this device, not to the closet or its backups. */
export const THEME_KEY = 'kid-closet:theme';
export const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#f4f1fb', dark: '#17142a' };
const DARK_QUERY = '(prefers-color-scheme: dark)';

export interface ThemeEnv {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  matchMedia: ((query: string) => Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>) | null;
  root: HTMLElement;
  themeColorMeta: HTMLMetaElement | null;
}

export function browserThemeEnv(): ThemeEnv {
  let storage: ThemeEnv['storage'] = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return {
    storage,
    matchMedia: typeof window.matchMedia === 'function' ? (q) => window.matchMedia(q) : null,
    root: document.documentElement,
    themeColorMeta: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]'),
  };
}

export function readChoice(storage: ThemeEnv['storage']): ThemeChoice {
  try {
    const v = storage?.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function saveChoice(storage: ThemeEnv['storage'], choice: ThemeChoice): void {
  try {
    storage?.setItem(THEME_KEY, choice);
  } catch {
    // Storage can be unavailable (e.g. private browsing); the choice then lasts until the app closes.
  }
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === 'system') return prefersDark ? 'dark' : 'light';
  return choice;
}

/** Same effect as the inline script in index.html, which runs before the page paints. */
export function applyTheme(env: ThemeEnv, theme: ResolvedTheme): void {
  env.root.dataset.theme = theme;
  env.root.style.colorScheme = theme;
  env.themeColorMeta?.setAttribute('content', THEME_COLORS[theme]);
}

export function useTheme(env: ThemeEnv): { choice: ThemeChoice; setChoice: (c: ThemeChoice) => void } {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readChoice(env.storage));

  useEffect(() => {
    const media = env.matchMedia?.(DARK_QUERY) ?? null;
    const update = () => applyTheme(env, resolveTheme(choice, media?.matches ?? false));
    update();
    if (choice !== 'system' || !media) return;
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [env, choice]);

  const setChoice = useCallback(
    (c: ThemeChoice) => {
      saveChoice(env.storage, c);
      setChoiceState(c);
    },
    [env],
  );

  return { choice, setChoice };
}
