import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ClosetChangedElsewhereError } from '../storage/repository';
import { renderWithCloset, sampleCloset } from '../test/fixtures';
import { DressUp, isColdSeason } from './DressUp';

const WARM_DAY = new Date('2026-06-01T08:00:00Z');
const COLD_DAY = new Date('2026-12-01T08:00:00Z');

function row(name: string) {
  return within(screen.getByRole('region', { name }));
}

describe('isColdSeason', () => {
  it('treats November to March as cold', () => {
    expect(isColdSeason(new Date('2026-11-15'))).toBe(true);
    expect(isColdSeason(new Date('2027-03-15'))).toBe(true);
    expect(isColdSeason(new Date('2026-04-15'))).toBe(false);
    expect(isColdSeason(new Date('2026-10-15'))).toBe(false);
  });
});

describe('DressUp', () => {
  it('shows a shirt and trousers for school on a warm day', async () => {
    await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, sampleCloset());
    expect(screen.queryByRole('region', { name: 'שכבה עליונה' })).not.toBeInTheDocument();
    expect(row('חולצה').getByText('חולצה כחולה')).toBeInTheDocument();
    expect(row('חולצה').getByText('· 1/3')).toBeInTheDocument();
    expect(row('מכנסיים').getByText('ג׳ינס')).toBeInTheDocument();
  });

  it('steps through shirts with the arrows', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, sampleCloset());
    await user.click(row('חולצה').getByRole('button', { name: 'הבא' }));
    expect(row('חולצה').getByText('חולצה לבנה')).toBeInTheDocument();
    await user.click(row('חולצה').getByRole('button', { name: 'הקודם' }));
    await user.click(row('חולצה').getByRole('button', { name: 'הקודם' }));
    expect(row('חולצה').getByText('חולצה ארוכה אפורה')).toBeInTheDocument();
  });

  it('adds the outer layer and long trousers when it is cold', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'קר' }));
    expect(row('שכבה עליונה').getByText('סוודר צהוב')).toBeInTheDocument();
    expect(row('מכנסיים').getByRole('button', { name: 'ניקוי סינון: ארוכים' })).toBeInTheDocument();
    expect(row('מכנסיים').getByText('· 1/1')).toBeInTheDocument();

    await user.click(row('שכבה עליונה').getByRole('button', { name: 'בלי' }));
    expect(row('שכבה עליונה').getByText('בלי שכבה עליונה היום')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'חם' }));
    expect(screen.queryByRole('region', { name: 'שכבה עליונה' })).not.toBeInTheDocument();
    expect(row('מכנסיים').getByText('· 1/2')).toBeInTheDocument();
  });

  it('filters a row by colour and type, and clears the filter', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'סוג וצבע של חולצה' }));
    const sheet = within(screen.getByRole('dialog', { name: 'סינון חולצה' }));
    expect(sheet.getByText('נמצאו 3')).toBeInTheDocument();
    await user.click(sheet.getByRole('button', { name: 'לבן' }));
    expect(sheet.getByText('נמצאו 1')).toBeInTheDocument();
    await user.click(sheet.getByRole('button', { name: 'סיום' }));

    expect(row('חולצה').getByText('חולצה לבנה')).toBeInTheDocument();
    await user.click(row('חולצה').getByRole('button', { name: 'ניקוי סינון: לבן' }));
    expect(row('חולצה').getByText('· 1/3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'סוג וצבע של חולצה' }));
    const sheet2 = within(screen.getByRole('dialog', { name: 'סינון חולצה' }));
    await user.click(sheet2.getByRole('button', { name: 'ארוכה' }));
    expect(sheet2.getByText('נמצאו 1')).toBeInTheDocument();
    await user.click(sheet2.getByRole('button', { name: 'ניקוי' }));
    expect(sheet2.getByText('נמצאו 3')).toBeInTheDocument();
    await user.click(sheet2.getByRole('button', { name: 'סגירה' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('switches occasion and drops the colour filter', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'סוג וצבע של חולצה' }));
    await user.click(screen.getByRole('button', { name: 'לבן' }));
    await user.click(screen.getByRole('button', { name: 'סיום' }));
    await user.click(screen.getByRole('button', { name: 'חגיגי' }));
    expect(row('חולצה').getByText('חולצה חגיגית')).toBeInTheDocument();
    expect(row('מכנסיים').getByText('מכנסיים לבנים')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ניקוי סינון/ })).not.toBeInTheDocument();
  });

  it('previews the look and saves it to favourites once', async () => {
    const user = userEvent.setup();
    const onOpenFavorites = vi.fn();
    const { repo } = await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={onOpenFavorites} />, sampleCloset());
    await user.click(row('חולצה').getByRole('button', { name: 'הבא' }));
    await user.click(screen.getByRole('button', { name: 'לראות את הלוק' }));
    expect(screen.getByRole('heading', { name: 'הלוק של היום' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'לשמור' }));
    expect(await screen.findByText('נשמר במועדפים')).toBeInTheDocument();
    expect(repo.getData().outfits[0]).toMatchObject({ topId: 'tWhite', bottomId: 'bJeans', layerId: null });
    expect(screen.getByRole('button', { name: 'שמור במועדפים' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'למועדפים' }));
    expect(onOpenFavorites).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'לשנות משהו' }));
    expect(screen.getByRole('heading', { name: 'לאן הולכים היום?' })).toBeInTheDocument();
  });

  it('says so when saving a look fails, but not when the "changed in another window" notice explains it', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, sampleCloset());
    await user.click(row('חולצה').getByRole('button', { name: 'הבא' }));
    await user.click(screen.getByRole('button', { name: 'לראות את הלוק' }));

    vi.spyOn(repo, 'update').mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('button', { name: 'לשמור' }));
    expect(await screen.findByText('השמירה לא הצליחה. נסי שוב.')).toBeInTheDocument();

    vi.spyOn(repo, 'update').mockRejectedValueOnce(new ClosetChangedElsewhereError());
    await user.click(screen.getByRole('button', { name: 'לשמור' }));
    expect(await screen.findByText(/הארון השתנה בחלון אחר/)).toBeInTheDocument();
    expect(screen.queryByText('השמירה לא הצליחה. נסי שוב.')).not.toBeInTheDocument();
  });

  it('opens a saved outfit', async () => {
    const data = sampleCloset();
    await renderWithCloset(<DressUp initialOutfit={data.outfits[0]} today={WARM_DAY} onOpenFavorites={vi.fn()} />, data);
    expect(row('שכבה עליונה').getByText('סוודר צהוב')).toBeInTheDocument();
    expect(row('חולצה').getByText('חולצה כחולה')).toBeInTheDocument();
    expect(row('מכנסיים').getByText('ג׳ינס')).toBeInTheDocument();
  });

  it('starts cold in winter and explains empty rows', async () => {
    await renderWithCloset(<DressUp today={COLD_DAY} onOpenFavorites={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'קר' })).toHaveAttribute('aria-pressed', 'true');
    expect(row('חולצה').getByText(/אין עדיין בגדים כאן/)).toBeInTheDocument();
    expect(row('מכנסיים').getByText('אין בגדים שמתאימים לסינון')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'צריך לבחור חולצה ומכנסיים' })).toBeDisabled();
    await userEvent.setup().click(row('מכנסיים').getByRole('button', { name: 'לבטל סינון' }));
    expect(row('מכנסיים').getByText(/אין עדיין בגדים כאן/)).toBeInTheDocument();
  });
});
