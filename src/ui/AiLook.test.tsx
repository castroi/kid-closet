import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AI_KEY_PREFIX, AI_USAGE_KEY } from '../app/aiDevice';
import { App } from '../app/App';
import { FINISHED_TOAST_MS, useAiLooks, type AiLookApi } from '../app/AiLooks';
import { DEFAULT_DOLL_URL } from '../app/doll';
import { AI_PROVIDERS } from '../ai/catalog';
import type { FetchLike } from '../ai/providers';
import type { ClosetData } from '../core/model';
import { cleanWebp } from '../test/photos';
import { fakeImageDeps, makeOutfit, memoryStorage, renderWithCloset, sampleCloset } from '../test/fixtures';
import { DressUp } from './DressUp';

const WARM_DAY = new Date('2026-06-01T08:00:00Z');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

function closetWithAi(): ClosetData {
  const data = sampleCloset();
  return { ...data, ai: { ...data.ai, provider: 'venice' } };
}

function readyStorage(extra: Record<string, string> = {}) {
  return memoryStorage({ [`${AI_KEY_PREFIX}venice`]: 'sk-venice-123', ...extra });
}

/** Answers the bundled doll and the look request. `look` decides the provider's answer. */
function provider(look: () => Promise<Response> = async () => new Response(PNG)) {
  return vi.fn<FetchLike>(async (url) => {
    if (url === DEFAULT_DOLL_URL) return new Response(new Uint8Array(cleanWebp));
    if (url === AI_PROVIDERS.venice.endpoints.look) return look();
    throw new TypeError(`unexpected ${url}`);
  });
}

async function openPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'לראות את הלוק' }));
}

describe('AI look in the preview', () => {
  it('shows no AI button until a provider and its key are set', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, sampleCloset(), { deviceStorage: readyStorage() });
    await openPreview(user);
    expect(screen.queryByRole('button', { name: 'להלביש את הבובה' })).not.toBeInTheDocument();
  });

  it('dresses the doll: sends the doll, shirt and trousers, saves the picture and shows it with the real photos', async () => {
    const user = userEvent.setup();
    const fetchFn = provider();
    const storage = readyStorage();
    const { repo } = await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, closetWithAi(), {
      deviceStorage: storage,
      fetchFn,
      now: () => WARM_DAY,
    });
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'להלביש את הבובה' }));

    expect(await screen.findByRole('img', { name: 'הבובה לובשת את הלוק' })).toBeInTheDocument();
    expect(screen.getByText('תמונת AI · צבעים וגזרה יכולים להיות שונים')).toBeInTheDocument();
    const real = within(screen.getByLabelText('הבגדים האמיתיים'));
    expect(real.getByRole('img', { name: 'חולצה כחולה' })).toBeInTheDocument();
    expect(real.getByRole('img', { name: 'ג׳ינס' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'להלביש את הבובה' })).not.toBeInTheDocument();

    const [look] = repo.getData().aiLooks;
    expect(look).toMatchObject({ dollId: 'default', upperId: 'tBlue', upperSlot: 'top', bottomId: 'bJeans', provider: 'venice' });
    expect(fetchFn).toHaveBeenCalledWith(DEFAULT_DOLL_URL, {});
    const body = JSON.parse(fetchFn.mock.calls.find(([url]) => url === AI_PROVIDERS.venice.endpoints.look)![1].body as string);
    expect(body.images).toHaveLength(3);
    expect(JSON.parse(storage.data.get(AI_USAGE_KEY)!)).toEqual({ month: '2026-06', count: 1 });
  });

  it('with a layer, sends the layer instead of the shirt and shows all three real photos', async () => {
    const user = userEvent.setup();
    const data = closetWithAi();
    data.outfits = [makeOutfit({ id: 'o', layerId: 'lJacket', topId: 'tWhite', bottomId: 'bJeans' })];
    const { repo } = await renderWithCloset(
      <DressUp initialOutfit={data.outfits[0]} today={WARM_DAY} onOpenFavorites={vi.fn()} />,
      data,
      { deviceStorage: readyStorage(), fetchFn: provider() },
    );
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'להלביש את הבובה' }));
    await screen.findByRole('img', { name: 'הבובה לובשת את הלוק' });
    expect(repo.getData().aiLooks[0]).toMatchObject({ upperId: 'lJacket', upperSlot: 'layer' });
    const real = within(screen.getByLabelText('הבגדים האמיתיים'));
    expect(real.getAllByRole('img')).toHaveLength(3);
  });

  it('shows the waiting screen, and "ביטול" only stops waiting: the picture is still saved', async () => {
    const user = userEvent.setup();
    let answer: (r: Response) => void = () => undefined;
    const fetchFn = provider(() => new Promise((resolve) => (answer = resolve)));
    const { repo } = await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, closetWithAi(), {
      deviceStorage: readyStorage(),
      fetchFn,
    });
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'להלביש את הבובה' }));
    expect(await screen.findByText('הבובה מתלבשת…')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(screen.queryByText('הבובה מתלבשת…', { selector: 'p' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הבובה מתלבשת…' })).toBeDisabled();

    await act(async () => answer(new Response(PNG)));
    await waitFor(() => expect(repo.getData().aiLooks).toHaveLength(1));
    expect(await screen.findByRole('img', { name: 'הבובה לובשת את הלוק' })).toBeInTheDocument();
  });

  it("tells her kindly when it didn't work, keeps her try, and counts only what may cost money", async () => {
    const user = userEvent.setup();
    const storage = readyStorage();
    const fetchFn = provider(async () => Response.json({ error: 'Invalid key' }, { status: 401 }));
    const { repo } = await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, closetWithAi(), {
      deviceStorage: storage,
      fetchFn,
    });
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'להלביש את הבובה' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('לא הצלחנו להלביש את הבובה הפעם. נסי שוב אחר כך.');
    expect(screen.queryByText(/Invalid key/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'להלביש את הבובה' })).toBeEnabled();
    expect(repo.getData().aiLooks).toEqual([]);
    expect(storage.data.has(AI_USAGE_KEY)).toBe(false); // rejected up front: not charged

    fetchFn.mockImplementation(async (url) =>
      url === DEFAULT_DOLL_URL ? new Response(new Uint8Array(cleanWebp)) : new Response('', { status: 503 }),
    );
    await user.click(screen.getByRole('button', { name: 'להלביש את הבובה' }));
    await waitFor(() => expect(storage.data.has(AI_USAGE_KEY)).toBe(true)); // reached the provider: counted
  });

  it('counts down only from 20, agrees with 1, and stops at 0 with the reset day', async () => {
    const user = userEvent.setup();
    const usage = (count: number) => readyStorage({ [AI_USAGE_KEY]: JSON.stringify({ month: '2026-06', count }) });
    const render = async (count: number) =>
      renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, closetWithAi(), {
        deviceStorage: usage(count),
        now: () => WARM_DAY,
      });

    const first = await render(79);
    await openPreview(user);
    expect(screen.queryByText(/נשארו עוד/)).not.toBeInTheDocument();
    first.unmount();

    const second = await render(80);
    await openPreview(user);
    expect(screen.getByText('נשארו עוד 20 בובות החודש')).toBeInTheDocument();
    second.unmount();

    const third = await render(99);
    await openPreview(user);
    expect(screen.getByText('נשארה עוד בובה אחת החודש')).toBeInTheDocument();
    third.unmount();

    await render(100);
    await openPreview(user);
    expect(screen.getByText('הבובות של החודש נגמרו. חוזרות ב־1 ביולי')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'להלביש את הבובה' })).toBeDisabled();
  });

  it('shows the button as soon as the parent saves the key, without restarting the app', async () => {
    const user = userEvent.setup();
    const storage = memoryStorage();
    await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, closetWithAi(), { deviceStorage: storage });
    await openPreview(user);
    expect(screen.queryByRole('button', { name: 'להלביש את הבובה' })).not.toBeInTheDocument();
    storage.setItem(`${AI_KEY_PREFIX}venice`, 'sk-venice-123'); // saved in the parent area meanwhile
    await user.click(screen.getByRole('button', { name: 'לשנות משהו' }));
    await openPreview(user);
    expect(screen.getByRole('button', { name: 'להלביש את הבובה' })).toBeInTheDocument();
  });

  it('says the dolls are off when the parent set the cap to 0, without promising a date', async () => {
    const user = userEvent.setup();
    const data = closetWithAi();
    data.ai.monthlyCap = 0;
    await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, data, { deviceStorage: readyStorage() });
    await openPreview(user);
    expect(screen.getByText('הבובות לא פעילות כרגע')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'להלביש את הבובה' })).toBeDisabled();
  });

  it('needs the internet', async () => {
    const user = userEvent.setup();
    let isOnline = false;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => isOnline });
    try {
      await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, closetWithAi(), { deviceStorage: readyStorage() });
      await openPreview(user);
      expect(screen.getByText('צריך אינטרנט')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'להלביש את הבובה' })).toBeDisabled();
      isOnline = true;
      act(() => {
        window.dispatchEvent(new Event('online'));
      });
      expect(screen.getByRole('button', { name: 'להלביש את הבובה' })).toBeEnabled();
    } finally {
      // Back to jsdom's own getter on Navigator.prototype.
      delete (navigator as unknown as Record<string, unknown>).onLine;
    }
  });

  it('switches to the photos, but a look always opens on the doll again; "לא דומה?" marks it for the parent', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, closetWithAi(), {
      deviceStorage: readyStorage(),
      fetchFn: provider(),
    });
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'להלביש את הבובה' }));
    await screen.findByRole('img', { name: 'הבובה לובשת את הלוק' });

    await user.click(screen.getByRole('button', { name: 'תמונות' }));
    expect(screen.queryByRole('img', { name: 'הבובה לובשת את הלוק' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'לשנות משהו' }));
    await openPreview(user);
    expect(await screen.findByRole('img', { name: 'הבובה לובשת את הלוק' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'לא דומה?' }));
    expect(await screen.findByText(/סימנו להורים/)).toBeInTheDocument();
    expect(repo.getData().aiLooks[0].flagged).toBe(true);
  });

  it('uses the parent’s own doll picture when she replaced it', async () => {
    const user = userEvent.setup();
    const data = { ...closetWithAi(), doll: { id: 'd1', image: 'images/doll-d1.webp' } };
    const fetchFn = provider();
    const { repo } = await renderWithCloset(<DressUp today={WARM_DAY} onOpenFavorites={vi.fn()} />, data, {
      deviceStorage: readyStorage(),
      fetchFn,
    });
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'להלביש את הבובה' }));
    await screen.findByRole('img', { name: 'הבובה לובשת את הלוק' });
    expect(fetchFn).not.toHaveBeenCalledWith(DEFAULT_DOLL_URL, {});
    expect(repo.getData().aiLooks[0].dollId).toBe('d1');
  });
});

describe('start() guards every paid request', () => {
  it('sends nothing for a look that exists, one already running, or past the cap; a redo is allowed', async () => {
    const grabbed: { api?: AiLookApi } = {};
    function Grab() {
      grabbed.api = useAiLooks();
      return null;
    }
    let answer: (r: Response) => void = () => undefined;
    const fetchFn = provider(() => new Promise((resolve) => (answer = resolve)));
    const data = closetWithAi();
    data.ai.monthlyCap = 2;
    const { repo } = await renderWithCloset(<Grab />, data, { deviceStorage: readyStorage(), fetchFn });
    const outfit = { occasion: 'school' as const, layerId: null, topId: 'tBlue', bottomId: 'bJeans' };
    const other = { ...outfit, topId: 'tWhite' };
    const third = { ...outfit, topId: 'tLong' };
    const lookCalls = () => fetchFn.mock.calls.filter(([url]) => url === AI_PROVIDERS.venice.endpoints.look).length;

    act(() => expect(grabbed.api!.start(outfit)).toBeNull());
    act(() => expect(grabbed.api!.start(outfit)).toBe('busy'));
    act(() => expect(grabbed.api!.start(other)).toBeNull());
    act(() => expect(grabbed.api!.start(third)).toBe('cap')); // two running already fill a cap of 2
    await waitFor(() => expect(lookCalls()).toBe(2));
    await act(async () => answer(new Response(PNG)));
    await waitFor(() => expect(repo.getData().aiLooks.length).toBeGreaterThan(0));
    const done = repo.getData().aiLooks[0];
    const doneOutfit = { ...outfit, topId: done.upperId };
    act(() => expect(grabbed.api!.start(doneOutfit)).toBe('exists'));
  });

  it('refuses when AI is not set up', async () => {
    const grabbed: { api?: AiLookApi } = {};
    function Grab() {
      grabbed.api = useAiLooks();
      return null;
    }
    await renderWithCloset(<Grab />, closetWithAi(), { deviceStorage: memoryStorage() });
    expect(grabbed.api!.start({ occasion: 'school', layerId: null, topId: 'tBlue', bottomId: 'bJeans' })).toBe('not-ready');
    expect(grabbed.api!.isReady()).toBe(false);
  });
});

describe('a look that finishes while she is elsewhere', () => {
  it('says "הבובה מוכנה" and "לראות" opens it', async () => {
    const user = userEvent.setup();
    let answer: (r: Response) => void = () => undefined;
    const fetchFn = provider(() => new Promise((resolve) => (answer = resolve)));
    await renderWithCloset(
      <App imageDeps={fakeImageDeps()} shareEnv={{ download: vi.fn() }} today={WARM_DAY} deviceStorage={readyStorage()} fetchFn={fetchFn} />,
      closetWithAi(),
    );
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'להלביש את הבובה' }));
    await screen.findByText('הבובה מתלבשת…');
    await user.click(screen.getByRole('button', { name: 'מועדפים' }));

    await act(async () => answer(new Response(PNG)));
    const toast = await screen.findByText('הבובה מוכנה');
    await user.click(within(toast.closest('.toast') as HTMLElement).getByRole('button', { name: 'לראות' }));
    expect(await screen.findByRole('img', { name: 'הבובה לובשת את הלוק' })).toBeInTheDocument();
    expect(screen.queryByText('הבובה מוכנה')).not.toBeInTheDocument();
  });

  it('goes away by itself after a while', async () => {
    const user = userEvent.setup();
    let answer: (r: Response) => void = () => undefined;
    const fetchFn = provider(() => new Promise((resolve) => (answer = resolve)));
    await renderWithCloset(
      <App imageDeps={fakeImageDeps()} shareEnv={{ download: vi.fn() }} today={WARM_DAY} deviceStorage={readyStorage()} fetchFn={fetchFn} />,
      closetWithAi(),
    );
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'להלביש את הבובה' }));
    await user.click(screen.getByRole('button', { name: 'מועדפים' }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await act(async () => answer(new Response(PNG)));
      await screen.findByText('הבובה מוכנה');
      await act(async () => {
        vi.advanceTimersByTime(FINISHED_TOAST_MS + 1);
      });
      expect(screen.queryByText('הבובה מוכנה')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
