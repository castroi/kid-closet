import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { THEME_KEY, applyTheme, browserThemeEnv, readChoice, resolveTheme, saveChoice, useTheme, type ThemeEnv } from './theme';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

function fakeMedia(matches: boolean) {
  let listener: (() => void) | null = null;
  const media = {
    matches,
    addEventListener: vi.fn((_t: string, fn: () => void) => {
      listener = fn;
    }),
    removeEventListener: vi.fn((_t: string, fn: () => void) => {
      if (listener === fn) listener = null;
    }),
  };
  return {
    media,
    flip(next: boolean) {
      media.matches = next;
      listener?.();
    },
  };
}

function env(overrides: Partial<ThemeEnv> = {}): ThemeEnv {
  const meta = document.createElement('meta');
  return { storage: memoryStorage(), matchMedia: null, root: document.createElement('html'), themeColorMeta: meta, ...overrides };
}

describe('theme helpers', () => {
  it('reads a saved choice, defaulting to the phone setting', () => {
    expect(readChoice(memoryStorage({ [THEME_KEY]: 'dark' }))).toBe('dark');
    expect(readChoice(memoryStorage({ [THEME_KEY]: 'neon' }))).toBe('system');
    expect(readChoice(null)).toBe('system');
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    };
    expect(readChoice(broken)).toBe('system');
  });

  it('saves a choice and ignores storage errors', () => {
    const s = memoryStorage();
    saveChoice(s, 'light');
    expect(s.data.get(THEME_KEY)).toBe('light');
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => saveChoice(broken, 'dark')).not.toThrow();
  });

  it('resolves the phone setting', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('applies the theme to the page and the status bar colour', () => {
    const e = env();
    applyTheme(e, 'dark');
    expect(e.root.dataset.theme).toBe('dark');
    expect(e.root.style.colorScheme).toBe('dark');
    expect(e.themeColorMeta?.getAttribute('content')).toBe('#17142a');
    applyTheme({ ...e, themeColorMeta: null }, 'light');
    expect(e.root.dataset.theme).toBe('light');
  });

  it('builds a browser environment', () => {
    const e = browserThemeEnv();
    expect(e.root).toBe(document.documentElement);
  });
});

describe('useTheme', () => {
  it('follows the phone and reacts when it changes', () => {
    const m = fakeMedia(false);
    const e = env({ matchMedia: () => m.media });
    const { result, unmount } = renderHook(() => useTheme(e));
    expect(result.current.choice).toBe('system');
    expect(e.root.dataset.theme).toBe('light');
    act(() => m.flip(true));
    expect(e.root.dataset.theme).toBe('dark');
    unmount();
    expect(m.media.removeEventListener).toHaveBeenCalled();
  });

  it('keeps a chosen theme regardless of the phone, and remembers it', () => {
    const m = fakeMedia(true);
    const storage = memoryStorage();
    const e = env({ matchMedia: () => m.media, storage });
    const { result } = renderHook(() => useTheme(e));
    act(() => result.current.setChoice('light'));
    expect(e.root.dataset.theme).toBe('light');
    expect(storage.data.get(THEME_KEY)).toBe('light');
    act(() => m.flip(true));
    expect(e.root.dataset.theme).toBe('light');
  });

  it('works without matchMedia', () => {
    const e = env();
    renderHook(() => useTheme(e));
    expect(e.root.dataset.theme).toBe('light');
  });
});
