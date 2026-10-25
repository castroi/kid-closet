import { fireEvent, screen, within } from '@testing-library/react';
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
    expect(row('מכנסיים').getByRole('button', { name: 'סוג וצבע של מכנסיים: ארוכים' })).toHaveAttribute('aria-pressed', 'true');
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
    // The button shows the active filter instead of a separate tag.
    const filterButton = row('חולצה').getByRole('button', { name: 'סוג וצבע של חולצה: לבן' });
    expect(filterButton).toHaveAttribute('aria-pressed', 'true');
    expect(filterButton).toHaveTextContent('לבן');
    await user.click(filterButton);
    await user.click(within(screen.getByRole('dialog', { name: 'סינון חולצה' })).getByRole('button', { name: 'ניקוי' }));
    await user.click(screen.getByRole('button', { name: 'סיום' }));
    // Clearing keeps the white shirt she was looking at, now among all three.
    expect(row('חולצה').getByText('חולצה לבנה')).toBeInTheDocument();
    expect(row('חולצה').getByText('· 2/3')).toBeInTheDocument();

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
    expect(row('חולצה').getByRole('button', { name: 'סוג וצבע של חולצה' })).toHaveAttribute('aria-pressed', 'false');
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

describe('DressUp gallery', () => {
  async function openShirtGallery(user: ReturnType<typeof userEvent.setup>) {
    await user.click(row('חולצה').getByRole('button', { name: 'גלריה של חולצה' }));
    return within(screen.getByRole('dialog'));
  }

  it('shows every shirt for the occasion, marks the current one, and picks by tapping', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, sampleCloset());
    const gallery = await openShirtGallery(user);
    expect(screen.getByRole('dialog', { name: 'חולצות' })).toBeInTheDocument();
    expect(gallery.getByText('3 בסך הכל')).toBeInTheDocument();
    // Only school shirts: not the festive one, not the outgrown one.
    expect(gallery.getByRole('button', { name: 'חולצה כחולה' })).toHaveAttribute('aria-current', 'true');
    expect(gallery.getByRole('button', { name: 'חולצה לבנה' })).not.toHaveAttribute('aria-current');
    expect(gallery.getByRole('button', { name: 'חולצה ארוכה אפורה' })).toBeInTheDocument();
    expect(gallery.queryByRole('button', { name: 'חולצה חגיגית' })).not.toBeInTheDocument();
    expect(gallery.queryByRole('button', { name: 'חולצה ישנה' })).not.toBeInTheDocument();

    await user.click(gallery.getByRole('button', { name: 'חולצה ארוכה אפורה' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(row('חולצה').getByText('חולצה ארוכה אפורה')).toBeInTheDocument();
    expect(row('חולצה').getByText('· 3/3')).toBeInTheDocument();
  });

  it('shows what the other rows have, for matching', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<DressUp today={COLD_DAY} onOpenFavorites={vi.fn()} />, sampleCloset());
    const gallery = await openShirtGallery(user);
    expect(gallery.getByText('כרגע בלוק:')).toBeInTheDocument();
    expect(gallery.getByRole('img', { name: 'סוודר צהוב' })).toBeInTheDocument();
    expect(gallery.getByRole('img', { name: 'ג׳ינס' })).toBeInTheDocument();
  });

  it('keeps the row filter, and clearing it in the gallery clears the row too', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'סוג וצבע של חולצה' }));
    await user.click(screen.getByRole('button', { name: 'לבן' }));
    await user.click(screen.getByRole('button', { name: 'סיום' }));

    const gallery = await openShirtGallery(user);
    expect(screen.getByRole('dialog', { name: 'חולצות לבנות' })).toBeInTheDocument();
    expect(gallery.getByText('1 מתוך 3')).toBeInTheDocument();
    expect(gallery.getAllByRole('button', { name: /^חולצה/ })).toHaveLength(1);
    expect(gallery.getByRole('button', { name: 'להציג את כל 3 החולצות' })).toBeInTheDocument();

    await user.click(gallery.getByRole('button', { name: 'ביטול הסינון: לבן' }));
    expect(screen.getByRole('dialog', { name: 'חולצות' })).toBeInTheDocument();
    expect(gallery.getByText('3 בסך הכל')).toBeInTheDocument();
    expect(gallery.queryByRole('button', { name: /להציג את כל/ })).not.toBeInTheDocument();
    await user.click(gallery.getByRole('button', { name: 'סגירה' }));
    expect(row('חולצה').getByRole('button', { name: 'סוג וצבע של חולצה' })).toHaveAttribute('aria-pressed', 'false');
    expect(row('חולצה').getByText('· 2/3')).toBeInTheDocument();
  });

  it('filters by type and colour inside the gallery, and "show all" clears the filter', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, sampleCloset());
    const gallery = await openShirtGallery(user);
    await user.click(gallery.getByRole('button', { name: 'קצרה' }));
    expect(screen.getByRole('dialog', { name: 'חולצות קצרות' })).toBeInTheDocument();
    expect(gallery.getByText('2 מתוך 3')).toBeInTheDocument();
    await user.click(gallery.getByRole('button', { name: 'כחול' }));
    expect(screen.getByRole('dialog', { name: 'חולצות קצרות כחולות' })).toBeInTheDocument();
    await user.click(gallery.getByRole('button', { name: 'להציג את כל 3 החולצות' }));
    expect(screen.getByRole('dialog', { name: 'חולצות' })).toBeInTheDocument();
    expect(gallery.getAllByRole('button', { name: /^חולצה/ })).toHaveLength(3);
  });

  it('explains when nothing matches and offers to clear the filter', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, sampleCloset());
    const gallery = await openShirtGallery(user);
    await user.click(gallery.getByRole('button', { name: 'ארוכה' }));
    await user.click(gallery.getByRole('button', { name: 'קצרה' }));
    await user.click(gallery.getByRole('button', { name: 'לבן' }));
    await user.click(gallery.getByRole('button', { name: 'ארוכה' }));
    expect(gallery.getByText('אין חולצות כאלה')).toBeInTheDocument();
    expect(gallery.getByText('0 מתוך 3')).toBeInTheDocument();
    await user.click(gallery.getByRole('button', { name: 'לבטל סינון' }));
    expect(gallery.getAllByRole('button', { name: /^חולצה/ })).toHaveLength(3);
  });

  it('opens from a tap on the photo, but not after a swipe', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, sampleCloset());
    const photo = row('חולצה').getByRole('button', { name: 'פתיחת הגלריה: חולצה כחולה' });

    // A swipe: the finger moves, then the browser still sends a click.
    fireEvent.pointerDown(photo, { clientX: 200, clientY: 100 });
    fireEvent.pointerUp(photo, { clientX: 120, clientY: 100 });
    // A click from a finger has detail 1 (keyboard and VoiceOver clicks have 0).
    fireEvent.click(photo, { detail: 1 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(row('חולצה').getByText('חולצה לבנה')).toBeInTheDocument();

    await user.click(row('חולצה').getByRole('button', { name: 'פתיחת הגלריה: חולצה לבנה' }));
    expect(screen.getByRole('dialog', { name: 'חולצות' })).toBeInTheDocument();
  });

  it('still opens from the keyboard after a swipe that ended without a click', async () => {
    await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, sampleCloset());
    const photo = row('חולצה').getByRole('button', { name: 'פתיחת הגלריה: חולצה כחולה' });
    // A small sideways move (not enough to change the shirt), then no click from the browser.
    fireEvent.pointerDown(photo, { clientX: 200, clientY: 100 });
    fireEvent.pointerUp(photo, { clientX: 180, clientY: 100 });
    // Enter or a VoiceOver double-tap: a click with detail 0.
    fireEvent.click(photo, { detail: 0 });
    expect(screen.getByRole('dialog', { name: 'חולצות' })).toBeInTheDocument();
  });

  it('closes without changing anything', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, sampleCloset());
    await openShirtGallery(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(row('חולצה').getByText('חולצה כחולה')).toBeInTheDocument();
  });

  it('works for trousers, with masculine plurals', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<DressUp today={COLD_DAY} onOpenFavorites={vi.fn()} />, sampleCloset());
    await user.click(row('מכנסיים').getByRole('button', { name: 'גלריה של מכנסיים' }));
    expect(screen.getByRole('dialog', { name: 'מכנסיים ארוכים' })).toBeInTheDocument();
    expect(screen.getByText('1 מתוך 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'להציג את כל 2 המכנסיים' })).toBeInTheDocument();
  });

  it('has no gallery for the outer layer when "בלי" is on', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<DressUp today={COLD_DAY} onOpenFavorites={vi.fn()} />, sampleCloset());
    await user.click(row('שכבה עליונה').getByRole('button', { name: 'בלי' }));
    expect(row('שכבה עליונה').getByRole('button', { name: 'גלריה של שכבה עליונה' })).toBeDisabled();
  });
});
