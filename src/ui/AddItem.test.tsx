import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AI_ANALYSIS_USAGE_KEY, AI_KEY_PREFIX } from '../app/aiDevice';
import type { FetchLike } from '../ai/providers';
import { emptyCloset } from '../core/model';
import type { ImageDeps } from '../image/processImage';
import { memoryStorage, renderWithCloset, sampleAttributes, testPhoto } from '../test/fixtures';
import { AddItem } from './AddItem';

function imageDeps(overrides: Partial<ImageDeps> = {}): ImageDeps {
  return {
    decode: vi.fn().mockResolvedValue({ width: 1000, height: 1000, release: vi.fn() }),
    draw: vi.fn().mockReturnValue({ imageData: {} as ImageData, toJpeg: vi.fn(), release: vi.fn() }),
    encodeWebp: vi.fn().mockResolvedValue(new Uint8Array([9, 9]).buffer),
    ...overrides,
  };
}

const photo = () => new File(['raw'], 'shirt.jpg', { type: 'image/jpeg' });

describe('AddItem', () => {
  it('saves a new item with a default name', async () => {
    const user = userEvent.setup();
    const onOpenCloset = vi.fn();
    const { repo, store } = await renderWithCloset(<AddItem imageDeps={imageDeps()} onOpenCloset={onOpenCloset} />);

    const save = screen.getByRole('button', { name: 'שמירה בארון' });
    expect(save).toBeDisabled();
    expect(screen.getByText('חסר: תמונה, סוג, לאן לובשים, צבע')).toBeInTheDocument();

    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    expect(await screen.findByAltText('התמונה שנבחרה')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'חולצה ארוכה' }));
    await user.click(screen.getByRole('button', { name: 'בית ספר' }));
    await user.click(screen.getByRole('button', { name: 'ירוק' }));
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'חולצה ארוכה בצבע ירוק');
    await user.click(save);

    expect(await screen.findByText('"חולצה ארוכה בצבע ירוק" נשמר בארון')).toBeInTheDocument();
    const [item] = repo.getData().items;
    expect(item).toMatchObject({ name: 'חולצה ארוכה בצבע ירוק', type: 'longTop', colorGroup: 'green', occasions: ['school'] });
    expect(item.image).toMatch(/\.webp$/);
    expect(store.files.has(item.image)).toBe(true);

    // The form is reset for the next item.
    expect(screen.getByText('עוד אין תמונה')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'לארון' }));
    expect(onOpenCloset).toHaveBeenCalled();
  });

  it('uses the typed name and the camera input', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<AddItem imageDeps={imageDeps()} onOpenCloset={vi.fn()} />);
    await user.upload(screen.getByLabelText('צילום בגד'), photo());
    await screen.findByAltText('התמונה שנבחרה');
    await user.click(screen.getByRole('button', { name: 'מכנסיים קצרים' }));
    await user.click(screen.getByRole('button', { name: 'יום רגיל' }));
    await user.click(screen.getByRole('button', { name: 'חגיגי' }));
    await user.click(screen.getByRole('button', { name: 'חגיגי' }));
    await user.click(screen.getByRole('button', { name: 'בז׳' }));
    await user.type(screen.getByRole('textbox'), 'שורטס של ים');
    await user.click(screen.getByRole('button', { name: 'שמירה בארון' }));
    await screen.findByText('"שורטס של ים" נשמר בארון');
    expect(repo.getData().items[0]).toMatchObject({ name: 'שורטס של ים', occasions: ['casual'] });
  });

  it('tells the user when a photo cannot be read', async () => {
    const user = userEvent.setup();
    const deps = imageDeps({ decode: vi.fn().mockRejectedValue(new Error('bad file')) });
    await renderWithCloset(<AddItem imageDeps={deps} onOpenCloset={vi.fn()} />);
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    expect(await screen.findByText('לא הצלחנו לקרוא את התמונה')).toBeInTheDocument();
  });

  it('keeps the latest photo when an earlier pick finishes last', async () => {
    const user = userEvent.setup();
    let finishFirst: (value: { width: number; height: number; release: () => void }) => void = () => undefined;
    const decode = vi
      .fn()
      .mockReturnValueOnce(new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValue({ width: 1000, height: 1000, release: vi.fn() });
    const encodeWebp = vi
      .fn()
      .mockResolvedValueOnce(new Uint8Array([2, 2, 2]).buffer) // the second pick encodes first
      .mockResolvedValueOnce(new Uint8Array([1]).buffer);
    const { repo, store } = await renderWithCloset(
      <AddItem imageDeps={imageDeps({ decode, encodeWebp })} onOpenCloset={vi.fn()} />,
    );

    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo()); // first pick, slow
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo()); // second pick, fast
    await screen.findByAltText('התמונה שנבחרה');
    finishFirst({ width: 1000, height: 1000, release: vi.fn() });
    await vi.waitFor(() => expect(encodeWebp).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: 'סוודר' }));
    await user.click(screen.getByRole('button', { name: 'בית ספר' }));
    await user.click(screen.getByRole('button', { name: 'כחול' }));
    await user.click(screen.getByRole('button', { name: 'שמירה בארון' }));
    await screen.findByText(/נשמר בארון/);
    const saved = await store.read(repo.getData().items[0].image);
    expect(saved?.size).toBe(3); // the second photo, not the stale first one
  });

  it('makes no preview after the screen closes mid-processing', async () => {
    const user = userEvent.setup();
    let finish: (value: { width: number; height: number; release: () => void }) => void = () => undefined;
    const decode = vi.fn().mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const { unmount } = await renderWithCloset(<AddItem imageDeps={imageDeps({ decode })} onOpenCloset={vi.fn()} />);
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    const createUrl = vi.spyOn(URL, 'createObjectURL');
    try {
      unmount();
      finish({ width: 1000, height: 1000, release: vi.fn() });
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(createUrl).not.toHaveBeenCalled();
    } finally {
      createUrl.mockRestore();
    }
  });

  it('shows an error when saving fails', async () => {
    const user = userEvent.setup();
    const { store } = await renderWithCloset(<AddItem imageDeps={imageDeps()} onOpenCloset={vi.fn()} />);
    vi.spyOn(store, 'write').mockRejectedValue(new Error('disk full'));
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    await screen.findByAltText('התמונה שנבחרה');
    await user.click(screen.getByRole('button', { name: 'סוודר' }));
    await user.click(screen.getByRole('button', { name: 'בית ספר' }));
    await user.click(screen.getByRole('button', { name: 'כחול' }));
    await user.click(screen.getByRole('button', { name: 'שמירה בארון' }));
    expect(await screen.findByText('לא הצלחנו לשמור את הבגד. נסי שוב.')).toBeInTheDocument();
  });
});

describe('AddItem and garment analysis', () => {
  const month = () => `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const answer = () =>
    Response.json({ choices: [{ message: { content: JSON.stringify({ valid_image: true, ...sampleAttributes() }) } }] });

  async function addOne(enabled: boolean) {
    const user = userEvent.setup();
    const data = emptyCloset();
    const closet = { ...data, ai: { ...data.ai, provider: 'venice' as const, analysis: { enabled, model: '', monthlyCap: 300 } } };
    const deviceStorage = memoryStorage({ [`${AI_KEY_PREFIX}venice`]: 'sk-venice-123' });
    const fetchFn = vi.fn<FetchLike>().mockImplementation(async () => answer());
    // A real (tiny) WebP, so the photo can be sent without its metadata.
    const deps = imageDeps({ encodeWebp: vi.fn().mockResolvedValue(testPhoto('webp').buffer) });
    const result = await renderWithCloset(<AddItem imageDeps={deps} onOpenCloset={vi.fn()} />, closet, { deviceStorage, fetchFn });
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    await screen.findByAltText('התמונה שנבחרה');
    await user.click(screen.getByRole('button', { name: 'חולצה ארוכה' }));
    await user.click(screen.getByRole('button', { name: 'בית ספר' }));
    await user.click(screen.getByRole('button', { name: 'ירוק' }));
    await user.click(screen.getByRole('button', { name: 'שמירה בארון' }));
    expect(await screen.findByText('"חולצה ארוכה בצבע ירוק" נשמר בארון')).toBeInTheDocument();
    return { ...result, fetchFn, deviceStorage };
  }

  it('sends the photo once and stores the answer with the garment, whatever she tapped meanwhile', async () => {
    const { repo, fetchFn, deviceStorage } = await addOne(true);
    await waitFor(() => expect(repo.getData().items[0].analysis?.result).toBe('ok'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(deviceStorage.getItem(AI_ANALYSIS_USAGE_KEY)!)).toEqual({ month: month(), count: 1 });
    // Nothing new on her screen: the same saved line, no AI words.
    expect(screen.queryByText(/AI/)).not.toBeInTheDocument();
  });

  it('sends nothing while analysis is off', async () => {
    const { repo, fetchFn } = await addOne(false);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(repo.getData().items[0].analysis).toBeNull();
  });
});

describe('the AI fills the form (decision 13)', () => {
  const answer = (patch: Record<string, unknown> = {}) =>
    Response.json({ choices: [{ message: { content: JSON.stringify({ valid_image: true, ...sampleAttributes(), ...patch }) } }] });

  /** Answers the provider only when the test says so. */
  function heldProvider() {
    const replies: ((r: Response) => void)[] = [];
    const fetchFn = vi.fn<FetchLike>(() => new Promise<Response>((resolve) => replies.push(resolve)));
    return { fetchFn, reply: (r: Response) => replies.shift()!(r) };
  }

  async function renderAdd(fetchFn: FetchLike, options: { enabled?: boolean; fillDeadlineMs?: number } = {}) {
    const data = emptyCloset();
    const closet = { ...data, ai: { ...data.ai, provider: 'venice' as const, analysis: { enabled: options.enabled ?? true, model: '', monthlyCap: 300 } } };
    const deviceStorage = memoryStorage({ [`${AI_KEY_PREFIX}venice`]: 'sk-venice-123' });
    const deps = imageDeps({ encodeWebp: vi.fn().mockResolvedValue(testPhoto('webp').buffer) });
    return renderWithCloset(
      <AddItem imageDeps={deps} onOpenCloset={vi.fn()} fillDeadlineMs={options.fillDeadlineMs} />,
      closet,
      { deviceStorage, fetchFn },
    );
  }

  const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

  it('fills type, colour and occasions, marks them, and stores every attribute with the garment she saves', async () => {
    const user = userEvent.setup();
    const { fetchFn, reply } = heldProvider();
    const { repo } = await renderAdd(fetchFn);
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    expect(await screen.findByText('ה־AI מסתכל על הבגד…')).toBeInTheDocument();
    // The form stays usable while waiting.
    expect(screen.getByRole('button', { name: 'חולצה קצרה' })).toBeEnabled();
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    await act(async () => reply(answer()));

    expect(await screen.findByText('ה־AI מילא את הפרטים · בדקי שהכול נכון')).toBeInTheDocument();
    expect(pressed('חולצה קצרה')).toBe('true');
    expect(pressed('ורוד')).toBe('true');
    expect(pressed('בית ספר')).toBe('true');
    expect(pressed('יום רגיל')).toBe('true');
    expect(screen.getAllByRole('img', { name: 'מולא על ידי ה־AI' })).toHaveLength(3);
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'חולצה קצרה בצבע ורוד');

    // She fixes the colour: that field's mark goes, and so does the "check" line.
    await user.click(screen.getByRole('button', { name: 'לבן' }));
    expect(screen.getAllByRole('img', { name: 'מולא על ידי ה־AI' })).toHaveLength(2);
    expect(screen.queryByText(/בדקי שהכול נכון/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'שמירה בארון' }));
    expect(await screen.findByText('"חולצה קצרה בצבע לבן" נשמר בארון')).toBeInTheDocument();
    const [item] = repo.getData().items;
    expect(item).toMatchObject({ type: 'tee', colorGroup: 'white', occasions: ['school', 'casual'] });
    // Every attribute is kept, also the ones the form doesn't show.
    await waitFor(() => expect(repo.getData().items[0].analysis).toMatchObject({ result: 'ok', attributes: sampleAttributes(), photoRevision: 0 }));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('never fills a field she already touched', async () => {
    const user = userEvent.setup();
    const { fetchFn, reply } = heldProvider();
    await renderAdd(fetchFn);
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    await screen.findByText('ה־AI מסתכל על הבגד…');
    await user.click(screen.getByRole('button', { name: 'מכנסיים ארוכים' }));
    // Tapped and un-tapped: still hers.
    await user.click(screen.getByRole('button', { name: 'חגיגי' }));
    await user.click(screen.getByRole('button', { name: 'חגיגי' }));
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    await act(async () => reply(answer()));
    await waitFor(() => expect(pressed('ורוד')).toBe('true'));
    expect(pressed('מכנסיים ארוכים')).toBe('true');
    expect(pressed('בית ספר')).toBe('false');
    expect(screen.getAllByRole('img', { name: 'מולא על ידי ה־AI' })).toHaveLength(1);
  });

  it('suggests a better photo when the AI sees no single garment, and fills nothing', async () => {
    const user = userEvent.setup();
    const { fetchFn, reply } = heldProvider();
    await renderAdd(fetchFn);
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    await act(async () => reply(Response.json({ choices: [{ message: { content: '{"valid_image":false,"notes":"Two items."}' } }] })));
    expect(await screen.findByText(/ה־AI לא הצליח לזהות את הבגד בתמונה/)).toBeInTheDocument();
    expect(pressed('חולצה קצרה')).toBe('false');
  });

  async function fillAndSave(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'חולצה ארוכה' }));
    await user.click(screen.getByRole('button', { name: 'בית ספר' }));
    await user.click(screen.getByRole('button', { name: 'ירוק' }));
    await user.click(screen.getByRole('button', { name: 'שמירה בארון' }));
    expect(await screen.findByText('"חולצה ארוכה בצבע ירוק" נשמר בארון')).toBeInTheDocument();
  }

  it('says nothing when a call that may have cost money fails, and never pays for it twice', async () => {
    const user = userEvent.setup();
    const fetchFn = vi.fn<FetchLike>().mockResolvedValueOnce(new Response('', { status: 503 })).mockImplementation(async () => answer());
    const { repo } = await renderAdd(fetchFn);
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    await waitFor(() => expect(screen.queryByText('ה־AI מסתכל על הבגד…')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('טיפ: לצלם על רקע חלק ובהיר')).toBeInTheDocument();
    await fillAndSave(user);
    await new Promise((r) => setTimeout(r, 20));
    // Not sent again by itself (§7); her "להראות ל־AI" or the parent's run can.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(repo.getData().items[0].analysis).toBeNull();
  });

  it('sends the garment after she saves it when the first call got no answer at all', async () => {
    const user = userEvent.setup();
    const fetchFn = vi.fn<FetchLike>().mockRejectedValueOnce(new TypeError('Load failed')).mockImplementation(async () => answer());
    const { repo } = await renderAdd(fetchFn);
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    await waitFor(() => expect(screen.queryByText('ה־AI מסתכל על הבגד…')).not.toBeInTheDocument());
    await fillAndSave(user);
    await waitFor(() => expect(repo.getData().items[0]?.analysis?.result).toBe('ok'));
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("clears the last photo's AI values when she picks another photo", async () => {
    const user = userEvent.setup();
    const { fetchFn, reply } = heldProvider();
    await renderAdd(fetchFn);
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    await act(async () => reply(answer()));
    await waitFor(() => expect(pressed('ורוד')).toBe('true'));
    // She set the type herself: that stays; the AI's colour and occasions go with the old photo.
    await user.click(screen.getByRole('button', { name: 'חולצה ארוכה' }));
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    expect(pressed('חולצה ארוכה')).toBe('true');
    expect(pressed('ורוד')).toBe('false');
    expect(pressed('בית ספר')).toBe('false');
    await act(async () => reply(answer({ primary_color: 'black' })));
    await waitFor(() => expect(pressed('שחור')).toBe('true'));
    expect(pressed('חולצה ארוכה')).toBe('true');
  });

  it('stores an answer that arrives after she saved, without filling the next form', async () => {
    const user = userEvent.setup();
    const { fetchFn, reply } = heldProvider();
    const { repo } = await renderAdd(fetchFn);
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    await user.click(screen.getByRole('button', { name: 'חולצה ארוכה' }));
    await user.click(screen.getByRole('button', { name: 'בית ספר' }));
    await user.click(screen.getByRole('button', { name: 'ירוק' }));
    await user.click(screen.getByRole('button', { name: 'שמירה בארון' }));
    expect(await screen.findByText('"חולצה ארוכה בצבע ירוק" נשמר בארון')).toBeInTheDocument();
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    await act(async () => reply(answer()));
    await waitFor(() => expect(repo.getData().items[0].analysis?.result).toBe('ok'));
    // The empty form for the next garment stays empty, and nothing was sent twice.
    expect(pressed('חולצה קצרה')).toBe('false');
    expect(pressed('ורוד')).toBe('false');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('sends one photo at a time, and never a photo she replaced before its turn', async () => {
    const user = userEvent.setup();
    const { fetchFn, reply } = heldProvider();
    await renderAdd(fetchFn);
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    // Two more picks while the first is out: only the last one is sent, after the first answer.
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await act(async () => reply(answer({ primary_color: 'black' })));
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    // The first photo's answer filled nothing: it is no longer on the form.
    expect(pressed('שחור')).toBe('false');
    await act(async () => reply(answer()));
    await waitFor(() => expect(pressed('ורוד')).toBe('true'));
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('stops waiting after the deadline and never changes the form later', async () => {
    const user = userEvent.setup();
    const { fetchFn, reply } = heldProvider();
    await renderAdd(fetchFn, { fillDeadlineMs: 30 });
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('ה־AI מסתכל על הבגד…')).not.toBeInTheDocument());
    await act(async () => reply(answer()));
    await new Promise((r) => setTimeout(r, 20));
    expect(pressed('ורוד')).toBe('false');
  });

  it('works as before while analysis is off', async () => {
    const user = userEvent.setup();
    const fetchFn = vi.fn<FetchLike>();
    await renderAdd(fetchFn, { enabled: false });
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    await screen.findByAltText('התמונה שנבחרה');
    expect(screen.queryByText('ה־AI מסתכל על הבגד…')).not.toBeInTheDocument();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
