import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ImageDeps } from '../image/processImage';
import { renderWithCloset, sampleCloset } from '../test/fixtures';
import { App } from './App';

const deps = {} as ImageDeps;
const WARM = new Date('2026-06-01T08:00:00Z');

describe('App', () => {
  it('navigates between the tabs', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<App imageDeps={deps} shareEnv={{ download: vi.fn() }} today={WARM} />, sampleCloset());
    expect(screen.getByRole('heading', { name: 'לאן הולכים היום?' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'מועדפים' }));
    expect(screen.getByRole('heading', { name: 'הלוקים שאהבתי' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'הארון שלי' }));
    expect(screen.getByRole('heading', { name: 'הארון שלי' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הארון שלי' })).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('button', { name: 'אזור הורים' }));
    expect(screen.getByRole('heading', { name: 'אזור הורים' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הארון שלי' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: 'חזרה לארון' }));

    await user.click(screen.getByRole('button', { name: 'הוספה' }));
    expect(screen.getByRole('heading', { name: 'בגד חדש' })).toBeInTheDocument();
  });

  it('lets her choose the theme from the closet screen', async () => {
    const user = userEvent.setup();
    const root = document.createElement('html');
    const data = new Map<string, string>();
    const themeEnv = {
      storage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) },
      matchMedia: null,
      root,
      themeColorMeta: null,
    };
    await renderWithCloset(<App imageDeps={deps} shareEnv={{ download: vi.fn() }} today={WARM} themeEnv={themeEnv} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'הארון שלי' }));
    await user.click(screen.getByRole('button', { name: 'הגדרות' }));
    const dialog = screen.getByRole('dialog', { name: 'הגדרות' });
    expect(within(dialog).getByRole('button', { name: 'כמו בטלפון' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'כהה' }));
    expect(root.dataset.theme).toBe('dark');
    expect(data.get('kid-closet:theme')).toBe('dark');
    expect(within(dialog).getByRole('button', { name: 'כהה' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'סיום' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a favourite in the dress-up screen', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<App imageDeps={deps} shareEnv={{ download: vi.fn() }} today={WARM} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'מועדפים' }));
    await user.click(screen.getByRole('button', { name: /^פתיחת הלוק/ }));
    expect(screen.getByRole('region', { name: 'שכבה עליונה' })).toBeInTheDocument();
    expect(screen.getByText('סוודר צהוב')).toBeInTheDocument();
  });
});
