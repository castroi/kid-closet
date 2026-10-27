import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AI_PROVIDERS } from '../ai/catalog';
import type { FetchLike } from '../ai/providers';
import { itemsToAnalyse } from '../core/closet';
import type { ClosetData } from '../core/model';
import { closetWith, makeAnalysis, makeItem, memoryStorage, renderWithCloset, sampleAttributes, testPhoto } from '../test/fixtures';
import { AI_ANALYSIS_USAGE_KEY, AI_KEY_PREFIX, AI_USAGE_KEY } from './aiDevice';
import { useCloset, type ClosetApi } from './ClosetContext';
import { AnalysisCapReached, useItemAnalysis, type ItemAnalysisApi } from './ItemAnalysis';

const month = () => `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

/** Exposes the queue and the closet to the test. */
const handles: { queue?: ItemAnalysisApi; closet?: ClosetApi } = {};
function Probe() {
  handles.queue = useItemAnalysis();
  handles.closet = useCloset();
  return null;
}
const queue = () => handles.queue!;
const closet = () => handles.closet!;

function closetWithAnalysis(items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })], analysis = { enabled: true, model: '', monthlyCap: 300 }): ClosetData {
  const data = closetWith(items);
  return { ...data, ai: { ...data.ai, provider: 'venice', analysis } };
}

const goodAnswer = (patch: Record<string, unknown> = {}) =>
  Response.json({ choices: [{ message: { content: JSON.stringify({ valid_image: true, ...sampleAttributes(), ...patch }) } }] });

function answering(reply: () => Response) {
  return vi.fn<FetchLike>(async () => reply());
}

async function setup(data: ClosetData, fetchFn: FetchLike, options: { usage?: number; dolls?: number; online?: () => boolean } = {}) {
  const storage = memoryStorage({ [`${AI_KEY_PREFIX}venice`]: 'sk-venice-123' });
  if (options.usage !== undefined) storage.setItem(AI_ANALYSIS_USAGE_KEY, JSON.stringify({ month: month(), count: options.usage }));
  if (options.dolls !== undefined) storage.setItem(AI_USAGE_KEY, JSON.stringify({ month: month(), count: options.dolls }));
  const result = await renderWithCloset(<Probe />, data, { deviceStorage: storage, fetchFn, isOnline: options.online });
  return { ...result, storage };
}

const used = (storage: ReturnType<typeof memoryStorage>, key = AI_ANALYSIS_USAGE_KEY) => {
  const raw = storage.data.get(key);
  return raw ? (JSON.parse(raw) as { count: number }).count : 0;
};

describe('ItemAnalysisProvider', () => {
  it('sends a new item, stores what the AI said with what made it, and counts it as an analysis only', async () => {
    const fetchFn = answering(() => goodAnswer());
    const { repo, storage } = await setup(closetWithAnalysis(), fetchFn, { dolls: 4 });
    act(() => {
      expect(queue().analyse('a', 'new')).toBeNull();
    });
    await waitFor(() => expect(repo.getData().items[0].analysis).not.toBeNull());
    expect(repo.getData().items[0].analysis).toMatchObject({
      result: 'ok',
      attributes: sampleAttributes(),
      photoRevision: 0,
      provider: 'venice',
      model: AI_PROVIDERS.venice.defaultAnalysisModel,
      promptVersion: 1,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(AI_PROVIDERS.venice.endpoints.analyze);
    expect(used(storage)).toBe(1);
    expect(used(storage, AI_USAGE_KEY)).toBe(4);
    expect(queue().jobs).toEqual({});
  });

  it('sends an item just saved, before the screen has the new closet (as the add screen does)', async () => {
    const fetchFn = answering(() => goodAnswer());
    const { repo } = await setup(closetWithAnalysis([]), fetchFn);
    await act(async () => {
      const image = { blob: new Blob([testPhoto('webp') as BlobPart], { type: 'image/webp' }), ext: 'webp' as const };
      const saved = await closet().addItem({ name: 'חדשה', type: 'tee', colorGroup: 'blue', occasions: ['school'] }, image);
      // Same tick as the save: the queue's closet doesn't have the item yet.
      expect(queue().analyse(saved.id, 'new', saved)).toBeNull();
    });
    await waitFor(() => expect(repo.getData().items[0].analysis?.result).toBe('ok'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('sends nothing while analysis is off, or without a key', async () => {
    const fetchFn = answering(() => goodAnswer());
    await setup(closetWithAnalysis(undefined, { enabled: false, model: '', monthlyCap: 300 }), fetchFn);
    act(() => {
      expect(queue().analyse('a', 'new')).toBe('not-ready');
      expect(queue().startBulk()).toBe('not-ready');
    });
    expect(queue().isReady()).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('skips an item already described, but lets her resend a photo the AI could not read', async () => {
    const fetchFn = answering(() => goodAnswer());
    const items = [
      makeItem({ id: 'a', analysis: makeAnalysis() }),
      makeItem({ id: 'b', analysis: makeAnalysis({ result: 'invalid-photo', notes: 'Blurry.', attributes: undefined } as never) }),
    ];
    const { repo } = await setup(closetWithAnalysis(items), fetchFn);
    act(() => {
      expect(queue().analyse('a', 'kid')).toBe('done');
      expect(queue().analyse('b', 'new')).toBe('done');
      expect(queue().analyse('b', 'kid')).toBeNull();
    });
    await waitFor(() => expect(repo.getData().items[1].analysis?.result).toBe('ok'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('sends a replaced photo again', async () => {
    const fetchFn = answering(() => goodAnswer());
    const { repo } = await setup(closetWithAnalysis([makeItem({ id: 'a', photoRevision: 1, analysis: makeAnalysis({ photoRevision: 0 }) })]), fetchFn);
    act(() => {
      expect(queue().analyse('a', 'new')).toBeNull();
    });
    await waitFor(() => expect(repo.getData().items[0].analysis?.photoRevision).toBe(1));
  });

  it('refuses at the cap, for her and for a bulk run', async () => {
    const fetchFn = answering(() => goodAnswer());
    await setup(closetWithAnalysis(undefined, { enabled: true, model: '', monthlyCap: 2 }), fetchFn, { usage: 2 });
    act(() => {
      expect(queue().analyse('a', 'kid')).toBe('cap');
      expect(queue().startBulk()).toBe('cap');
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('keeps a failure for her screen, counting it only when it may have cost money', async () => {
    const fetchFn = answering(() => new Response('', { status: 503 }));
    const { storage } = await setup(closetWithAnalysis(), fetchFn);
    act(() => {
      queue().analyse('a', 'kid');
    });
    await waitFor(() => expect(queue().jobs.a?.kind).toBe('failed'));
    expect(used(storage)).toBe(1);

    fetchFn.mockImplementation(async () => new Response('', { status: 401 }));
    act(() => {
      expect(queue().analyse('a', 'kid')).toBeNull(); // a failed item can be tried again
    });
    await waitFor(() => expect(queue().jobs.a).toMatchObject({ kind: 'failed', error: { reason: 'unauthorized' } }));
    expect(used(storage)).toBe(1);
  });

  it('waits for the internet, then sends her items when the phone is back online', async () => {
    let online = false;
    const fetchFn = answering(() => goodAnswer());
    const { repo } = await setup(closetWithAnalysis(), fetchFn, { online: () => online });
    act(() => {
      queue().analyse('a', 'new');
    });
    await waitFor(() => expect(queue().jobs.a).toMatchObject({ kind: 'failed', source: 'new', error: { reason: 'network' } }));
    expect(fetchFn).not.toHaveBeenCalled();
    online = true;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(repo.getData().items[0].analysis).not.toBeNull());
  });

  it('drops an answer that arrives after the item was deleted', async () => {
    let answer: (r: Response) => void = () => undefined;
    const fetchFn = vi.fn<FetchLike>(() => new Promise<Response>((resolve) => (answer = resolve)));
    const { repo, storage } = await setup(closetWithAnalysis(), fetchFn);
    act(() => {
      queue().analyse('a', 'new');
    });
    await waitFor(() => expect(queue().jobs.a?.kind).toBe('waiting'));
    await act(async () => {
      await closet().deleteItems(['a']);
    });
    await act(async () => {
      answer(goodAnswer());
    });
    await waitFor(() => expect(queue().jobs).toEqual({}));
    expect(repo.getData().items.map((it) => it.id)).toEqual(['b']);
    expect(repo.getData().items[0].analysis).toBeNull();
    expect(used(storage)).toBe(1); // it was paid for
  });
});

describe('bulk run', () => {
  const items = () => [
    makeItem({ id: 'a' }),
    makeItem({ id: 'b' }),
    makeItem({ id: 'done', analysis: makeAnalysis() }),
    makeItem({ id: 'old', status: 'outgrown' }),
  ];

  it('sends every active item that is not analysed, one at a time, and sums up', async () => {
    let inFlight = 0;
    let most = 0;
    const fetchFn = vi.fn<FetchLike>(async () => {
      most = Math.max(most, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return goodAnswer();
    });
    const { repo, storage } = await setup(closetWithAnalysis(items()), fetchFn);
    expect(itemsToAnalyse(closet().data.items).map((it) => it.id)).toEqual(['a', 'b']);
    act(() => {
      expect(queue().startBulk()).toBeNull();
    });
    expect(queue().bulk).toMatchObject({ total: 2, running: true });
    await waitFor(() => expect(queue().bulk?.running).toBe(false));
    expect(queue().bulk).toMatchObject({ total: 2, analysed: 2, failed: [], stoppedBy: null });
    expect(most).toBe(1);
    expect(repo.getData().items.filter((it) => it.analysis !== null).map((it) => it.id)).toEqual(['a', 'b', 'done']);
    expect(used(storage)).toBe(2);
    act(() => queue().clearBulk());
    expect(queue().bulk).toBeNull();
    act(() => {
      expect(queue().startBulk()).toBe('done');
    });
  });

  it('keeps going past one failure and lists it', async () => {
    const fetchFn = vi.fn<FetchLike>().mockResolvedValueOnce(goodAnswer({ pattern: 'paisley' })).mockResolvedValue(goodAnswer());
    await setup(closetWithAnalysis(items()), fetchFn);
    act(() => {
      queue().startBulk();
    });
    await waitFor(() => expect(queue().bulk?.running).toBe(false));
    expect(queue().bulk).toMatchObject({ analysed: 1, failed: [{ id: 'a', error: { reason: 'bad-response' } }] });
  });

  it('stops at once on a key, credit or rate problem, which every item would hit', async () => {
    const fetchFn = answering(() => new Response('', { status: 402 }));
    await setup(closetWithAnalysis(items()), fetchFn);
    act(() => {
      queue().startBulk();
    });
    await waitFor(() => expect(queue().bulk?.running).toBe(false));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(queue().bulk?.stoppedBy).toMatchObject({ reason: 'no-credit' });
    expect(queue().jobs.b).toBeUndefined();
  });

  it('stops at the cap', async () => {
    const fetchFn = answering(() => goodAnswer());
    const { storage } = await setup(closetWithAnalysis(items(), { enabled: true, model: '', monthlyCap: 1 }), fetchFn);
    act(() => {
      queue().startBulk();
    });
    await waitFor(() => expect(queue().bulk?.running).toBe(false));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(queue().bulk?.stoppedBy).toBeInstanceOf(AnalysisCapReached);
    expect(used(storage)).toBe(1);
  });

  it('"עצירה" lets the current item finish and starts nothing new', async () => {
    let answer: (r: Response) => void = () => undefined;
    const fetchFn = vi.fn<FetchLike>(() => new Promise<Response>((resolve) => (answer = resolve)));
    const { repo } = await setup(closetWithAnalysis(items()), fetchFn);
    act(() => {
      queue().startBulk();
    });
    await waitFor(() => expect(queue().jobs.a?.kind).toBe('waiting'));
    act(() => queue().stopBulk());
    expect(queue().bulk).toMatchObject({ running: true, stopping: true });
    expect(queue().jobs.b).toBeUndefined();
    await act(async () => {
      answer(goodAnswer());
    });
    await waitFor(() => expect(queue().bulk?.running).toBe(false));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(queue().bulk).toMatchObject({ analysed: 1, stopping: false });
    expect(repo.getData().items[0].analysis).not.toBeNull();
  });

  it('ends when the parent turns analysis off, and skips an item deleted before its turn', async () => {
    let answer: (r: Response) => void = () => undefined;
    const fetchFn = vi.fn<FetchLike>(() => new Promise<Response>((resolve) => (answer = resolve)));
    await setup(closetWithAnalysis([makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' }), makeItem({ id: 'd' })]), fetchFn);
    act(() => {
      queue().startBulk();
    });
    await waitFor(() => expect(queue().jobs.a?.kind).toBe('waiting'));
    await act(async () => {
      await closet().deleteItems(['b']);
    });
    await act(async () => {
      answer(goodAnswer());
    });
    await waitFor(() => expect(queue().jobs.c?.kind).toBe('waiting'));
    expect(queue().bulk).toMatchObject({ analysed: 1, skipped: 1 });
    await act(async () => {
      await closet().setAiSettings({ analysis: { enabled: false, model: '', monthlyCap: 300 } });
    });
    await act(async () => {
      answer(goodAnswer());
    });
    await waitFor(() => expect(queue().bulk?.running).toBe(false));
    expect(queue().bulk).toMatchObject({ analysed: 2, skipped: 1, stoppedBy: 'off' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('ends without sending when the phone is offline', async () => {
    const fetchFn = answering(() => goodAnswer());
    await setup(closetWithAnalysis(items()), fetchFn, { online: () => false });
    act(() => {
      queue().startBulk();
    });
    await waitFor(() => expect(queue().bulk?.running).toBe(false));
    expect(fetchFn).not.toHaveBeenCalled();
    expect(queue().bulk?.stoppedBy).toMatchObject({ reason: 'network' });
  });
});

describe('bulk run next to her own request', () => {
  it('leaves her queued garment out of the run, so the progress adds up', async () => {
    let reply: (r: Response) => void = () => undefined;
    const fetchFn = vi.fn<FetchLike>(() => new Promise<Response>((resolve) => (reply = resolve)));
    await setup(closetWithAnalysis([makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' })]), fetchFn);
    act(() => {
      queue().analyse('a', 'kid'); // being sent
      queue().analyse('b', 'kid'); // queued behind it
      expect(queue().startBulk()).toBeNull();
    });
    expect(queue().bulk?.total).toBe(1);
    for (let i = 0; i < 3; i++) {
      await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(i + 1));
      await act(async () => reply(goodAnswer()));
    }
    await waitFor(() => expect(queue().bulk?.running).toBe(false));
    expect(queue().bulk).toMatchObject({ total: 1, analysed: 1, skipped: 0, failed: [] });
  });
});

describe('review fixes', () => {
  it('puts her request ahead of a running bulk run', async () => {
    const replies: ((r: Response) => void)[] = [];
    const fetchFn = vi.fn<FetchLike>(() => new Promise<Response>((resolve) => replies.push(resolve)));
    // An outgrown garment isn't part of a bulk run, but she can still show it to the AI herself.
    await setup(closetWithAnalysis([makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' }), makeItem({ id: 'mine', status: 'outgrown' })]), fetchFn);
    act(() => {
      expect(queue().startBulk()).toBeNull();
    });
    expect(queue().bulk?.total).toBe(3);
    await waitFor(() => expect(queue().jobs.a?.kind).toBe('waiting'));
    act(() => {
      expect(queue().analyse('mine', 'kid')).toBeNull();
    });
    await act(async () => replies[0](goodAnswer()));
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    // The second call is hers, ahead of b and c.
    expect(queue().jobs.mine?.kind).toBe('waiting');
    expect(queue().jobs.b?.kind).toBe('queued');
  });

  it('keeps who asked on a failure, so only her resend shows her an error', async () => {
    const fetchFn = vi.fn<FetchLike>().mockImplementation(async () => new Response('', { status: 503 }));
    await setup(closetWithAnalysis(), fetchFn);
    act(() => {
      queue().analyse('a', 'new');
      queue().analyse('b', 'kid');
    });
    await waitFor(() => expect(queue().jobs.b?.kind).toBe('failed'));
    expect(queue().jobs.a).toMatchObject({ kind: 'failed', source: 'new' });
    expect(queue().jobs.b).toMatchObject({ kind: 'failed', source: 'kid' });
  });

  it('records why a run stopped even when the last garment hit it', async () => {
    const fetchFn = vi.fn<FetchLike>().mockResolvedValueOnce(goodAnswer()).mockResolvedValue(new Response('', { status: 401 }));
    await setup(closetWithAnalysis(), fetchFn);
    act(() => {
      queue().startBulk();
    });
    await waitFor(() => expect(queue().bulk?.running).toBe(false));
    expect(queue().bulk).toMatchObject({ analysed: 1, failed: [{ id: 'b' }], stoppedBy: { reason: 'unauthorized' } });
  });

  it('stops a run when there is no answer at all (offline or CORS) while the phone says it is online', async () => {
    const fetchFn = vi.fn<FetchLike>().mockRejectedValue(new TypeError('Load failed'));
    await setup(closetWithAnalysis([makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' })]), fetchFn);
    act(() => {
      queue().startBulk();
    });
    await waitFor(() => expect(queue().bulk?.running).toBe(false));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(queue().bulk?.stoppedBy).toMatchObject({ reason: 'network' });
  });

  it('sends her garment again on the "online" event after a call that got no answer', async () => {
    const fetchFn = vi.fn<FetchLike>().mockRejectedValueOnce(new TypeError('Load failed')).mockImplementation(async () => goodAnswer());
    const { repo } = await setup(closetWithAnalysis(), fetchFn);
    act(() => {
      queue().analyse('a', 'kid');
    });
    await waitFor(() => expect(queue().jobs.a).toMatchObject({ kind: 'failed', error: { reason: 'network' } }));
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(repo.getData().items[0].analysis?.result).toBe('ok'));
  });
});
