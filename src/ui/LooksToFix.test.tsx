import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AI_KEY_PREFIX, AI_USAGE_KEY } from '../app/aiDevice';
import { useAiLooks } from '../app/AiLooks';
import { DEFAULT_DOLL_URL } from '../app/doll';
import { AI_PROVIDERS } from '../ai/catalog';
import type { FetchLike } from '../ai/providers';
import type { AiLook, ClosetData } from '../core/model';
import { cleanWebp } from '../test/photos';
import { makeLook, memoryStorage, renderWithCloset, sampleCloset } from '../test/fixtures';
import { LooksToFix } from './LooksToFix';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

function closetWithLooks(looks: AiLook[], ready = true): ClosetData {
  const data = sampleCloset();
  return { ...data, ai: { ...data.ai, provider: ready ? 'venice' : null }, aiLooks: looks };
}

function provider(look: () => Promise<Response> = async () => new Response(PNG)) {
  return vi.fn<FetchLike>(async (url) => {
    if (url === DEFAULT_DOLL_URL) return new Response(new Uint8Array(cleanWebp));
    if (url === AI_PROVIDERS.venice.endpoints.look) return look();
    throw new TypeError(`unexpected ${url}`);
  });
}

const readyStorage = (extra: Record<string, string> = {}) =>
  memoryStorage({ [`${AI_KEY_PREFIX}venice`]: 'sk-venice-123', ...extra });

/** Shows the toast the kid would see, so a test can tell it stayed away. */
function FinishedProbe() {
  const ai = useAiLooks();
  return ai.finished ? <p>הבובה מוכנה</p> : null;
}

const flagged = makeLook({ id: 'f1', flagged: true, createdAt: '2026-10-20T08:00:00.000Z' });

describe('LooksToFix', () => {
  it('says there is nothing to fix when she flagged nothing', async () => {
    await renderWithCloset(<LooksToFix />, closetWithLooks([makeLook({ id: 'ok' })]));
    expect(screen.getByText(/אין לוקים לתיקון/)).toBeInTheDocument();
  });

  it('lists each flagged look with the real clothes and the day it was made', async () => {
    await renderWithCloset(<LooksToFix />, closetWithLooks([flagged, makeLook({ id: 'ok', bottomId: 'bShorts' })]));
    const rows = screen.getAllByRole('region');
    expect(rows).toHaveLength(1);
    const row = within(rows[0]);
    expect(row.getByRole('img', { name: 'חולצה כחולה' })).toBeInTheDocument();
    expect(row.getByRole('img', { name: 'ג׳ינס' })).toBeInTheDocument();
    expect(row.getByText('נוצר ב־20 באוקטובר')).toBeInTheDocument();
  });

  it('makes the look again: replaces the picture, clears the flag, keeps it on screen, counts the use, and shows her no toast', async () => {
    const user = userEvent.setup();
    const storage = readyStorage();
    const fetchFn = provider();
    const { repo } = await renderWithCloset(
      <>
        <LooksToFix />
        <FinishedProbe />
      </>,
      closetWithLooks([flagged]),
      { deviceStorage: storage, fetchFn, now: () => new Date(2026, 9, 26) },
    );
    await user.click(screen.getByRole('button', { name: 'ליצור מחדש' }));

    await waitFor(() => expect(repo.getData().aiLooks[0]?.id).not.toBe('f1'));
    const [look] = repo.getData().aiLooks;
    expect(repo.getData().aiLooks).toHaveLength(1);
    expect(look).toMatchObject({ upperId: 'tBlue', bottomId: 'bJeans', flagged: false });
    expect(JSON.parse(storage.data.get(AI_USAGE_KEY)!).count).toBe(1);
    expect(await screen.findByText(/התמונה נוצרה מחדש/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ליצור מחדש' })).toBeEnabled();
    expect(screen.queryByText('הבובה מוכנה')).not.toBeInTheDocument();

    // Keeping the new picture takes it off the list.
    await user.click(screen.getByRole('button', { name: 'להשאיר' }));
    expect(await screen.findByText(/אין לוקים לתיקון/)).toBeInTheDocument();
    expect(repo.getData().aiLooks).toEqual([look]);
  });

  it('makes a look with a layer again with the layer, not a shirt', async () => {
    const user = userEvent.setup();
    const fetchFn = provider();
    const { repo } = await renderWithCloset(
      <LooksToFix />,
      closetWithLooks([makeLook({ id: 'f1', flagged: true, upperId: 'lJacket', upperSlot: 'layer' })]),
      { deviceStorage: readyStorage(), fetchFn },
    );
    await user.click(screen.getByRole('button', { name: 'ליצור מחדש' }));
    await waitFor(() => expect(repo.getData().aiLooks[0]?.id).not.toBe('f1'));
    expect(repo.getData().aiLooks[0]).toMatchObject({ upperId: 'lJacket', upperSlot: 'layer', bottomId: 'bJeans' });
  });

  it('explains a failed attempt to the parent and keeps the old picture', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<LooksToFix />, closetWithLooks([flagged]), {
      deviceStorage: readyStorage(),
      fetchFn: provider(async () => new Response('nope', { status: 401 })),
    });
    await user.click(screen.getByRole('button', { name: 'ליצור מחדש' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('הספק לא קיבל את המפתח');
    expect(repo.getData().aiLooks).toEqual([flagged]);
  });

  it('sends nothing when AI is not set up or the month is used up, and says why', async () => {
    const user = userEvent.setup();
    const fetchFn = provider();
    await renderWithCloset(<LooksToFix />, closetWithLooks([flagged], false), { deviceStorage: readyStorage(), fetchFn });
    await user.click(screen.getByRole('button', { name: 'ליצור מחדש' }));
    expect(screen.getByRole('status')).toHaveTextContent('צריך קודם להגדיר ספק ומפתח');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses at the monthly cap', async () => {
    const user = userEvent.setup();
    const fetchFn = provider();
    const data = closetWithLooks([flagged]);
    data.ai.monthlyCap = 1;
    const storage = readyStorage({ [AI_USAGE_KEY]: JSON.stringify({ month: '2026-10', count: 1 }) });
    await renderWithCloset(<LooksToFix />, data, { deviceStorage: storage, fetchFn, now: () => new Date(2026, 9, 26) });
    await user.click(screen.getByRole('button', { name: 'ליצור מחדש' }));
    expect(screen.getByRole('status')).toHaveTextContent('הגעת למקסימום התמונות של החודש');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('keeps the picture: clears the flag only', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<LooksToFix />, closetWithLooks([flagged]));
    await user.click(screen.getByRole('button', { name: 'להשאיר' }));
    await waitFor(() => expect(repo.getData().aiLooks).toEqual([{ ...flagged, flagged: false }]));
    expect(screen.getByText(/אין לוקים לתיקון/)).toBeInTheDocument();
  });

  it('deletes the picture and its file', async () => {
    const user = userEvent.setup();
    const { repo, store } = await renderWithCloset(<LooksToFix />, closetWithLooks([flagged]));
    store.files.set(flagged.image, new Blob(['look']));
    await user.click(screen.getByRole('button', { name: 'למחוק את התמונה' }));
    await waitFor(() => expect(repo.getData().aiLooks).toEqual([]));
    expect(store.files.has(flagged.image)).toBe(false);
  });

  it('offers only keep or delete for a look made with an earlier doll', async () => {
    await renderWithCloset(<LooksToFix />, closetWithLooks([{ ...flagged, dollId: 'old-doll' }]), { deviceStorage: readyStorage() });
    expect(screen.queryByRole('button', { name: 'ליצור מחדש' })).not.toBeInTheDocument();
    expect(screen.getByText(/נוצרה עם בובה קודמת/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'להשאיר' })).toBeInTheDocument();
  });
});
