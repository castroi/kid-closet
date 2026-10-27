import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AI_ANALYSIS_USAGE_KEY, AI_KEY_PREFIX } from '../app/aiDevice';
import type { FetchLike } from '../ai/providers';
import { hebrewDay } from '../core/gallery';
import type { ClosetData } from '../core/model';
import { ClosetChangedElsewhereError } from '../storage/repository';
import {
  closetWith,
  fakeImageDeps,
  makeAnalysis,
  makeItem,
  makeLook,
  memoryStorage,
  renderWithCloset,
  sampleAttributes,
  sampleCloset,
  testPhoto,
} from '../test/fixtures';
import { Closet } from './Closet';

describe('Closet', () => {
  it('lists items by category and counts active ones', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={fakeImageDeps()} />, sampleCloset());
    expect(screen.getByText('9 בגדים בארון')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'חולצות (4)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'עריכת חולצה כחולה' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'קטן עליי (1)' }));
    expect(screen.getByRole('button', { name: 'עריכת חולצה ישנה' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'עריכת חולצה כחולה' })).not.toBeInTheDocument();
  });

  it('moves selected items to outgrown, with undo', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={fakeImageDeps()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'בחירה' }));
    const move = screen.getByRole('button', { name: 'העברה ל"קטן עליי" (0)' });
    expect(move).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'חולצה כחולה' }));
    await user.click(screen.getByRole('button', { name: 'חולצה לבנה' }));
    expect(screen.getByText('נבחרו 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'העברה ל"קטן עליי" (2)' }));

    expect(await screen.findByText('הועבר ל"קטן עליי" (2)')).toBeInTheDocument();
    expect(repo.getData().items.filter((i) => i.status === 'outgrown')).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(repo.getData().items.filter((i) => i.status === 'outgrown')).toHaveLength(1);
  });

  it('clears the selection when switching tabs', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={fakeImageDeps()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'בחירה' }));
    await user.click(screen.getByRole('button', { name: 'חולצה כחולה' }));
    await user.click(screen.getByRole('button', { name: 'מכנסיים (3)' }));
    expect(screen.getByRole('button', { name: 'העברה ל"קטן עליי" (0)' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(screen.getByRole('button', { name: 'בחירה' })).toBeInTheDocument();
  });

  it('brings items back from outgrown', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={fakeImageDeps()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'קטן עליי (1)' }));
    await user.click(screen.getByRole('button', { name: 'בחירה' }));
    await user.click(screen.getByRole('button', { name: 'חולצה ישנה' }));
    await user.click(screen.getByRole('button', { name: 'החזרה לארון (1)' }));
    expect(await screen.findByText('הוחזר לארון (1)')).toBeInTheDocument();
    expect(repo.getData().items.every((i) => i.status === 'active')).toBe(true);
    expect(screen.getByText(/בגדים שקטנים עלייך יופיעו כאן/)).toBeInTheDocument();
  });

  it('edits an item', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={fakeImageDeps()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה כחולה' }));
    const dialog = within(screen.getByRole('dialog', { name: 'עריכת בגד' }));
    await user.click(dialog.getByRole('button', { name: 'יום רגיל' }));
    await user.clear(dialog.getByRole('textbox'));
    await user.type(dialog.getByRole('textbox'), 'החולצה עם הכוכבים');
    await user.click(dialog.getByRole('button', { name: 'ורוד' }));
    await user.click(dialog.getByRole('button', { name: 'שמירה' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(repo.getData().items.find((i) => i.id === 'tBlue')).toMatchObject({
      name: 'החולצה עם הכוכבים',
      colorGroup: 'pink',
      occasions: ['school', 'casual'],
    });
  });

  it('requires at least one occasion when editing', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={fakeImageDeps()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה כחולה' }));
    const dialog = within(screen.getByRole('dialog', { name: 'עריכת בגד' }));
    await user.click(dialog.getByRole('button', { name: 'בית ספר' }));
    expect(dialog.getByText('חסר: לאן לובשים')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'שמירה' })).toBeDisabled();
  });

  it('marks one item as outgrown from the editor', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={fakeImageDeps()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה כחולה' }));
    await user.click(screen.getByRole('button', { name: 'קטן עליי' }));
    expect(repo.getData().items.find((i) => i.id === 'tBlue')?.status).toBe('outgrown');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a failed "outgrown" inside the editor, where she is looking', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={fakeImageDeps()} />, sampleCloset());
    vi.spyOn(repo, 'update').mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה כחולה' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'קטן עליי' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('לא הצלחנו לשמור. נסי שוב.');
    expect(repo.getData().items.find((i) => i.id === 'tBlue')?.status).toBe('active');
    // She can try again from the same sheet.
    expect(dialog.getByRole('button', { name: 'קטן עליי' })).toBeEnabled();
    await user.click(dialog.getByRole('button', { name: 'קטן עליי' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(repo.getData().items.find((i) => i.id === 'tBlue')?.status).toBe('outgrown');
  });

  it('shows a failed move next to the move button', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={fakeImageDeps()} />, sampleCloset());
    vi.spyOn(repo, 'update').mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('button', { name: 'בחירה' }));
    await user.click(screen.getByRole('button', { name: 'חולצה כחולה' }));
    const moveButton = screen.getByRole('button', { name: 'העברה ל"קטן עליי" (1)' });
    await user.click(moveButton);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('לא הצלחנו לשמור. נסי שוב.');
    expect(alert.parentElement).toBe(moveButton.parentElement); // in the action bar, not below the list
  });

  it('clears an old error once she moves on', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={fakeImageDeps()} />, sampleCloset());
    const failOnce = () => vi.spyOn(repo, 'update').mockRejectedValueOnce(new Error('disk full'));

    failOnce();
    await user.click(screen.getByRole('button', { name: 'בחירה' }));
    await user.click(screen.getByRole('button', { name: 'חולצה כחולה' }));
    await user.click(screen.getByRole('button', { name: 'העברה ל"קטן עליי" (1)' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'מכנסיים (3)' })); // another tab
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    failOnce();
    await user.click(screen.getByRole('button', { name: 'ג׳ינס' }));
    await user.click(screen.getByRole('button', { name: 'העברה ל"קטן עליי" (1)' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'ביטול' })); // leaves selection mode
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'בחירה' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a failed undo next to the undo toast', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={fakeImageDeps()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה כחולה' }));
    await user.click(screen.getByRole('button', { name: 'קטן עליי' }));
    await screen.findByText('הועבר ל"קטן עליי" (1)');
    vi.spyOn(repo, 'update').mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('button', { name: 'ביטול' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('לא הצלחנו לבטל. נסי שוב.');
    expect(alert.parentElement).toBe(screen.getByText('הועבר ל"קטן עליי" (1)').closest('.action-bar'));
    expect(repo.getData().items.find((i) => i.id === 'tBlue')?.status).toBe('outgrown');
  });

  it('adds no second message when the "changed in another window" notice explains it', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={fakeImageDeps()} />, sampleCloset());
    vi.spyOn(repo, 'update').mockRejectedValueOnce(new ClosetChangedElsewhereError());
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה כחולה' }));
    await user.click(screen.getByRole('button', { name: 'קטן עליי' }));
    expect(await screen.findByText(/הארון השתנה בחלון אחר/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens the parent area and the settings', async () => {
    const user = userEvent.setup();
    const onOpenParent = vi.fn();
    const onOpenSettings = vi.fn();
    await renderWithCloset(<Closet onOpenParent={onOpenParent} onOpenSettings={onOpenSettings} imageDeps={fakeImageDeps()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'אזור הורים' }));
    expect(onOpenParent).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'הגדרות' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('shows an empty state', async () => {
    await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={fakeImageDeps()} />);
    expect(screen.getByText(/אין עדיין בגדים כאן/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'בחירה' })).toBeDisabled();
  });
});

describe('Closet and the AI', () => {
  const month = () => `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const answer = () =>
    Response.json({ choices: [{ message: { content: JSON.stringify({ valid_image: true, ...sampleAttributes() }) } }] });

  function closetForAi(enabled = true, monthlyCap = 300): ClosetData {
    const items = [
      makeItem({ id: 'known', name: 'חולצה מוכרת', analysis: makeAnalysis() }),
      makeItem({ id: 'fresh', name: 'חולצה חדשה' }),
      makeItem({ id: 'blurry', name: 'חולצה מטושטשת', analysis: makeAnalysis({ result: 'invalid-photo', notes: 'Blurry.', attributes: undefined } as never) }),
      makeItem({ id: 'stale', name: 'חולצה שהתמונה שלה הוחלפה', photoRevision: 1, analysis: makeAnalysis({ photoRevision: 0 }) }),
    ];
    const data = closetWith(items);
    return { ...data, ai: { ...data.ai, provider: 'venice', analysis: { enabled, model: '', monthlyCap } } };
  }

  async function renderCloset(data: ClosetData, fetchFn: FetchLike = vi.fn<FetchLike>().mockImplementation(async () => answer()), usage = 0) {
    const deviceStorage = memoryStorage({
      [`${AI_KEY_PREFIX}venice`]: 'sk-venice-123',
      [AI_ANALYSIS_USAGE_KEY]: JSON.stringify({ month: month(), count: usage }),
    });
    return renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={fakeImageDeps()} />, data, { deviceStorage, fetchFn });
  }

  it('marks only the garments the AI described, on their current photo, without dimming any photo', async () => {
    const { container } = await renderCloset(closetForAi());
    expect(screen.getByRole('button', { name: 'עריכת חולצה מוכרת · ה־AI מכיר' })).toBeInTheDocument();
    for (const name of ['חולצה חדשה', 'חולצה מטושטשת', 'חולצה שהתמונה שלה הוחלפה']) {
      expect(screen.getByRole('button', { name: `עריכת ${name}` })).toBeInTheDocument();
    }
    expect(container.querySelectorAll('.card .fav-ai-mark')).toHaveLength(1);
    expect(container.querySelector('.card .thumb img.faded, .card .thumb.faded')).toBeNull();
  });

  it('tells her the AI knows a garment, with nothing to press', async () => {
    const user = userEvent.setup();
    await renderCloset(closetForAi());
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה מוכרת · ה־AI מכיר' }));
    expect(screen.getByText('ה־AI כבר מכיר את הבגד הזה')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /AI/ })).not.toBeInTheDocument();
  });

  it('lets her show a garment to the AI, then marks it', async () => {
    const user = userEvent.setup();
    let reply: (r: Response) => void = () => undefined;
    const fetchFn = vi.fn<FetchLike>(() => new Promise<Response>((resolve) => (reply = resolve)));
    const { repo, container } = await renderCloset(closetForAi(), fetchFn);
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה חדשה' }));
    await user.click(screen.getByRole('button', { name: 'להראות ל־AI' }));
    expect(await screen.findByRole('button', { name: 'ה־AI מסתכל על הבגד…' })).toBeDisabled();
    // While waiting, the card's mark is faded; the photo never is.
    expect(container.querySelector('.card .fav-ai-mark.pending')).not.toBeNull();
    await act(async () => reply(answer()));
    expect(await screen.findByText('ה־AI כבר מכיר את הבגד הזה')).toBeInTheDocument();
    expect(repo.getData().items[1].analysis?.result).toBe('ok');
  });

  it('explains a photo the AI could not read and lets her try again; a replaced photo counts as new', async () => {
    const user = userEvent.setup();
    await renderCloset(closetForAi());
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה מטושטשת' }));
    expect(screen.getByText(/כדאי לצלם על רקע חלק ובהיר/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'לנסות שוב עם ה־AI' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'סגירה' }));
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה שהתמונה שלה הוחלפה' }));
    expect(screen.getByRole('button', { name: 'להראות ל־AI' })).toBeEnabled();
  });

  it('shows her one friendly line when it fails, never the provider message', async () => {
    const user = userEvent.setup();
    const fetchFn = vi.fn<FetchLike>().mockResolvedValue(Response.json({ error: 'Upstream exploded' }, { status: 502 }));
    await renderCloset(closetForAi(), fetchFn);
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה חדשה' }));
    await user.click(screen.getByRole('button', { name: 'להראות ל־AI' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('לא הצלחנו הפעם. נסי שוב אחר כך.');
    expect(screen.queryByText(/Upstream/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'לנסות שוב עם ה־AI' })).toBeEnabled();
  });

  it('waits for next month at the cap', async () => {
    const user = userEvent.setup();
    await renderCloset(closetForAi(true, 5), undefined, 5);
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה חדשה' }));
    expect(screen.getByRole('button', { name: 'להראות ל־AI' })).toBeDisabled();
    const next = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
    expect(screen.getByText(`אפשר לנסות שוב ב־${hebrewDay(next)}`)).toBeInTheDocument();
  });

  it('shows nothing about the AI while the parent has analysis off', async () => {
    const user = userEvent.setup();
    await renderCloset(closetForAi(false));
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה חדשה' }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /AI/ })).not.toBeInTheDocument();
  });
});

describe('her AI row only speaks for her own tap', () => {
  it('stays silent about an automatic send that failed, and says when she needs the internet', async () => {
    const user = userEvent.setup();
    const data = closetWith([makeItem({ id: 'fresh', name: 'חולצה חדשה' })]);
    const closet = { ...data, ai: { ...data.ai, provider: 'venice' as const, analysis: { enabled: true, model: '', monthlyCap: 300 } } };
    const deviceStorage = memoryStorage({ [`${AI_KEY_PREFIX}venice`]: 'sk-venice-123' });
    let online = true;
    const fetchFn = vi.fn<FetchLike>().mockResolvedValue(new Response('', { status: 503 }));
    await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={fakeImageDeps()} />, closet, { deviceStorage, fetchFn, isOnline: () => online });
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה חדשה' }));
    const sheet = within(screen.getByRole('dialog'));

    // Her own tap fails: one friendly line.
    await user.click(sheet.getByRole('button', { name: 'להראות ל־AI' }));
    expect(await sheet.findByRole('alert')).toHaveTextContent('לא הצלחנו הפעם');

    // Offline: no error, just what she needs.
    online = false;
    await user.click(sheet.getByRole('button', { name: 'לנסות שוב עם ה־AI' }));
    expect(await sheet.findByText('צריך אינטרנט. ננסה שוב כשיהיה.')).toBeInTheDocument();
    expect(sheet.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('replacing a photo', () => {
  const webpDeps = () => fakeImageDeps({ encodeWebp: vi.fn().mockResolvedValue(testPhoto('webp').buffer) });
  const file = () => new File(['raw'], 'new.jpg', { type: 'image/jpeg' });

  it('replaces the photo, says so, and sends it to the AI again when analysis is on', async () => {
    const user = userEvent.setup();
    const data = {
      ...closetWith([makeItem({ id: 'a', name: 'חולצה כחולה', analysis: makeAnalysis() }), makeItem({ id: 'p', name: 'ג׳ינס', type: 'pants' })]),
      aiLooks: [makeLook({ id: 'l1', upperId: 'a', bottomId: 'p' })],
    };
    const closet = { ...data, ai: { ...data.ai, provider: 'venice' as const, analysis: { enabled: true, model: '', monthlyCap: 300 } } };
    const deviceStorage = memoryStorage({ [`${AI_KEY_PREFIX}venice`]: 'sk-venice-123' });
    const fetchFn = vi.fn<FetchLike>().mockImplementation(async () =>
      Response.json({ choices: [{ message: { content: JSON.stringify({ valid_image: true, ...sampleAttributes(), short_title: 'New shirt' }) } }] }),
    );
    const { repo } = await renderWithCloset(
      <Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={webpDeps()} />,
      closet,
      { deviceStorage, fetchFn },
    );
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה כחולה · ה־AI מכיר' }));
    const sheet = within(screen.getByRole('dialog'));
    expect(sheet.getByText('ה־AI כבר מכיר את הבגד הזה')).toBeInTheDocument();

    await user.upload(sheet.getByLabelText('תמונה חדשה מהגלריה'), file());
    expect(await sheet.findByText('התמונה הוחלפה')).toBeInTheDocument();
    await waitFor(() => expect(repo.getData().items[0].analysis?.attributes).toMatchObject({ short_title: 'New shirt' }));
    expect(repo.getData().items[0]).toMatchObject({ photoRevision: 1, analysis: { photoRevision: 1 } });
    expect(repo.getData().aiLooks[0].flagged).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await sheet.findByText('ה־AI כבר מכיר את הבגד הזה')).toBeInTheDocument();
  });

  it('replaces the photo without sending anything while analysis is off', async () => {
    const user = userEvent.setup();
    const fetchFn = vi.fn<FetchLike>();
    const { repo } = await renderWithCloset(
      <Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={webpDeps()} />,
      closetWith([makeItem({ id: 'a', name: 'חולצה כחולה' })]),
      { fetchFn },
    );
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה כחולה' }));
    const sheet = within(screen.getByRole('dialog'));
    const before = (await sheet.findByRole('img', { name: 'חולצה כחולה' })).getAttribute('src');
    await user.upload(screen.getByLabelText('צילום תמונה חדשה'), file());
    expect(await screen.findByText('התמונה הוחלפה')).toBeInTheDocument();
    expect(repo.getData().items[0].photoRevision).toBe(1);
    // Same path, new revision: the photo is read again instead of showing the old one.
    await waitFor(() => expect(sheet.getByRole('img', { name: 'חולצה כחולה' }).getAttribute('src')).not.toBe(before));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('says so when the photo cannot be read, and keeps the old one', async () => {
    const user = userEvent.setup();
    const deps = fakeImageDeps({ decode: vi.fn().mockRejectedValue(new Error('not a picture')) });
    const { repo } = await renderWithCloset(
      <Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} imageDeps={deps} />,
      closetWith([makeItem({ id: 'a', name: 'חולצה כחולה' })]),
    );
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה כחולה' }));
    await user.upload(screen.getByLabelText('תמונה חדשה מהגלריה'), file());
    expect(await screen.findByRole('alert')).toHaveTextContent('לא הצלחנו לקרוא את התמונה');
    expect(repo.getData().items[0].photoRevision).toBe(0);
  });
});
