import { screen } from '@testing-library/react';
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

  it('opens a favourite in the dress-up screen', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<App imageDeps={deps} shareEnv={{ download: vi.fn() }} today={WARM} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'מועדפים' }));
    await user.click(screen.getByRole('button', { name: /^פתיחת הלוק/ }));
    expect(screen.getByRole('region', { name: 'שכבה עליונה' })).toBeInTheDocument();
    expect(screen.getByText('סוודר צהוב')).toBeInTheDocument();
  });
});
