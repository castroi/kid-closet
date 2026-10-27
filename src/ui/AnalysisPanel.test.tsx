import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AI_ANALYSIS_USAGE_KEY, AI_KEY_PREFIX, AI_USAGE_KEY } from '../app/aiDevice';
import { SAMPLE_GARMENT_URL } from '../app/sampleGarment';
import { AI_PROVIDERS } from '../ai/catalog';
import type { FetchLike } from '../ai/providers';
import { emptyCloset, type AiSettings, type ClosetData } from '../core/model';
import { closetWith, fakeImageDeps, makeAnalysis, makeItem, memoryStorage, renderWithCloset, sampleAttributes } from '../test/fixtures';
import { cleanWebp } from '../test/photos';
import { AiPanel, AiSettingsScreen } from './AiSettings';

const OCT = new Date(2026, 9, 26, 12);
const month = () => `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

function closetWithAi(ai: Partial<AiSettings>): ClosetData {
  const data = emptyCloset();
  return { ...data, ai: { ...data.ai, ...ai } };
}

const answer = (content: string) => Response.json({ choices: [{ message: { content } }] });
const goodAnswer = () => answer(JSON.stringify({ valid_image: true, ...sampleAttributes(), short_title: 'Navy striped t-shirt' }));

/** Serves the bundled sample photo, then answers the analysis call with `reply`. */
function fetchWith(reply: () => Response) {
  return vi.fn<FetchLike>(async (url) => (url === SAMPLE_GARMENT_URL ? new Response(new Uint8Array(cleanWebp)) : reply()));
}

async function renderScreen(ai: Partial<AiSettings> = {}, storage = memoryStorage(), fetchFn?: FetchLike) {
  // The same phone storage for the screen and the analysis queue, as in the app.
  const result = await renderWithCloset(
    <AiSettingsScreen deviceStorage={storage} imageDeps={fakeImageDeps()} fetchFn={fetchFn} />,
    closetWithAi({ provider: 'openrouter', ...ai }),
    { deviceStorage: storage, fetchFn },
  );
  return { ...result, storage, panel: within(screen.getByRole('region', { name: 'זיהוי בגדים' })) };
}

function withKey(extra: Record<string, string> = {}) {
  return memoryStorage({ [`${AI_KEY_PREFIX}openrouter`]: 'sk-or-v1-abcdef', ...extra });
}

describe('AnalysisPanel', () => {
  it('appears only once a provider is picked, explains what is sent, and starts off', async () => {
    await renderWithCloset(<AiSettingsScreen deviceStorage={memoryStorage()} imageDeps={fakeImageDeps()} />, emptyCloset());
    expect(screen.queryByRole('region', { name: 'זיהוי בגדים' })).not.toBeInTheDocument();

    const { panel } = await renderScreen();
    expect(panel.getByText(/נשלחת רק התמונה, בלי שם ובלי מיקום/)).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'כבוי' })).toHaveAttribute('aria-pressed', 'true');
    expect(panel.getByLabelText(/מודל לזיהוי/)).toHaveAttribute('placeholder', AI_PROVIDERS.openrouter.defaultAnalysisModel);
  });

  it('turns analysis on and off', async () => {
    const user = userEvent.setup();
    const { repo, panel } = await renderScreen();
    await user.click(panel.getByRole('button', { name: 'פועל' }));
    expect(await panel.findByText(/זיהוי הבגדים פועל/)).toBeInTheDocument();
    expect(repo.getData().ai.analysis.enabled).toBe(true);
    // Pressing the chosen side again changes nothing.
    await user.click(panel.getByRole('button', { name: 'פועל' }));
    expect(repo.getData().ai.analysis.enabled).toBe(true);
    await user.click(panel.getByRole('button', { name: 'כבוי' }));
    expect(await panel.findByText('זיהוי הבגדים כבוי.')).toBeInTheDocument();
    expect(repo.getData().ai.analysis.enabled).toBe(false);
  });

  it('saves its own model and cap, apart from the dolls, and refuses a bad cap', async () => {
    const user = userEvent.setup();
    const { repo, panel } = await renderScreen({ model: 'meta/muse-image', monthlyCap: 100 });
    expect(panel.getByRole('button', { name: 'שמירה' })).toBeDisabled();
    const cap = panel.getByLabelText(/מקסימום זיהויים בחודש/);
    expect(cap).toHaveValue('300');
    for (const bad of ['5001', '1e2', ' 50']) {
      await user.clear(cap);
      await user.type(cap, bad);
      expect(panel.getByText('מספר שלם בין 0 ל־5000')).toBeInTheDocument();
      expect(panel.getByRole('button', { name: 'שמירה' })).toBeDisabled();
    }
    await user.clear(cap);
    await user.type(cap, '500');
    await user.type(panel.getByLabelText(/מודל לזיהוי/), ' other/vision ');
    await user.click(panel.getByRole('button', { name: 'שמירה' }));
    expect(await panel.findByText('ההגדרות נשמרו.')).toBeInTheDocument();
    expect(repo.getData().ai).toMatchObject({ model: 'meta/muse-image', monthlyCap: 100, analysis: { enabled: false, model: 'other/vision', monthlyCap: 500 } });
  });

  it('checks with the bundled sample photo, even while off, and counts it as an analysis only', async () => {
    const user = userEvent.setup();
    const storage = withKey({ [AI_USAGE_KEY]: JSON.stringify({ month: month(), count: 7 }) });
    const fetchFn = fetchWith(goodAnswer);
    const { repo, panel } = await renderScreen({}, storage, fetchFn);
    expect(panel.getByText('0 מתוך 300')).toBeInTheDocument();

    await user.click(panel.getByRole('button', { name: 'בדיקת זיהוי' }));
    const status = await panel.findByText(/הזיהוי עובד/);
    expect(within(status).getByText('Navy striped t-shirt')).toHaveAttribute('dir', 'ltr');
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([SAMPLE_GARMENT_URL, AI_PROVIDERS.openrouter.endpoints.analyze]);
    expect(panel.getByText('1 מתוך 300')).toBeInTheDocument();
    expect(JSON.parse(storage.data.get(AI_ANALYSIS_USAGE_KEY)!).count).toBe(1);
    expect(JSON.parse(storage.data.get(AI_USAGE_KEY)!).count).toBe(7);
    expect(repo.getData().items).toEqual([]);
  });

  it('says so when the model saw no garment in the sample', async () => {
    const user = userEvent.setup();
    const { panel } = await renderScreen({}, withKey(), fetchWith(() => answer('{"valid_image":false,"notes":"Empty."}')));
    await user.click(panel.getByRole('button', { name: 'בדיקת זיהוי' }));
    expect(await panel.findByText(/לא זיהה בגד בתמונת הדוגמה/)).toBeInTheDocument();
  });

  it("explains a failure with the provider's words, counting it only when it may have cost money", async () => {
    const user = userEvent.setup();
    const storage = withKey();
    const fetchFn = fetchWith(() => Response.json({ error: { message: 'Upstream error' } }, { status: 502 }));
    const { panel } = await renderScreen({}, storage, fetchFn);
    await user.click(panel.getByRole('button', { name: 'בדיקת זיהוי' }));
    const status = await panel.findByText(/אצל הספק יש תקלה/);
    expect(status).toHaveTextContent('(502 Upstream error)');
    expect(JSON.parse(storage.data.get(AI_ANALYSIS_USAGE_KEY)!).count).toBe(1);

    fetchFn.mockImplementation(async (url) =>
      url === SAMPLE_GARMENT_URL ? new Response(new Uint8Array(cleanWebp)) : Response.json({ error: 'bad key' }, { status: 401 }),
    );
    await user.click(panel.getByRole('button', { name: 'בדיקת זיהוי' }));
    expect(await panel.findByText(/הספק לא קיבל את המפתח/)).toBeInTheDocument();
    expect(JSON.parse(storage.data.get(AI_ANALYSIS_USAGE_KEY)!).count).toBe(1);
  });

  it('reports an answer that does not fit the schema, which still counts', async () => {
    const user = userEvent.setup();
    const storage = withKey();
    const { panel } = await renderScreen({}, storage, fetchWith(() => answer('{"valid_image":true}')));
    await user.click(panel.getByRole('button', { name: 'בדיקת זיהוי' }));
    expect(await panel.findByText(/תשובה שאי אפשר להשתמש בה/)).toBeInTheDocument();
    expect(JSON.parse(storage.data.get(AI_ANALYSIS_USAGE_KEY)!).count).toBe(1);
  });

  it('does not call the provider without a key, at the cap, or when the sample is missing', async () => {
    const user = userEvent.setup();
    const fetchFn = fetchWith(goodAnswer);
    const noKey = await renderScreen({}, memoryStorage(), fetchFn);
    await user.click(noKey.panel.getByRole('button', { name: 'בדיקת זיהוי' }));
    expect(noKey.panel.getByText('צריך קודם לשמור מפתח API.')).toBeInTheDocument();
    noKey.unmount();

    const atCap = await renderScreen(
      { analysis: { enabled: true, model: '', monthlyCap: 2 } },
      withKey({ [AI_ANALYSIS_USAGE_KEY]: JSON.stringify({ month: month(), count: 2 }) }),
      fetchFn,
    );
    await user.click(atCap.panel.getByRole('button', { name: 'בדיקת זיהוי' }));
    expect(atCap.panel.getByText(/הגעת למגבלת הזיהויים של החודש/)).toBeInTheDocument();
    expect(fetchFn).not.toHaveBeenCalled();
    atCap.unmount();

    const missing = vi.fn<FetchLike>().mockResolvedValue(new Response('', { status: 404 }));
    const noSample = await renderScreen({}, withKey(), missing);
    await user.click(noSample.panel.getByRole('button', { name: 'בדיקת זיהוי' }));
    expect(await noSample.panel.findByText(/לא הצלחנו לקרוא את אחת התמונות/)).toBeInTheDocument();
    expect(missing).toHaveBeenCalledTimes(1);
  });
});

describe('AiPanel with analysis', () => {
  it('says when garment analysis is on', async () => {
    const storage = memoryStorage({ [`${AI_KEY_PREFIX}venice`]: 'k' });
    await renderWithCloset(
      <AiPanel deviceStorage={storage} now={OCT} onOpen={vi.fn()} onOpenFix={vi.fn()} />,
      closetWithAi({ provider: 'venice', analysis: { enabled: true, model: '', monthlyCap: 300 } }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('מוגדר · Venice · זיהוי בגדים פועל');
  });
});

describe('sending existing clothes (bulk)', () => {
  const items = () => [
    makeItem({ id: 'known', name: 'מוכרת', analysis: makeAnalysis() }),
    makeItem({ id: 'blurry', name: 'מטושטשת', analysis: makeAnalysis({ result: 'invalid-photo', notes: null, attributes: undefined } as never) }),
    makeItem({ id: 'a', name: 'חולצה א' }),
    makeItem({ id: 'b', name: 'חולצה ב' }),
    makeItem({ id: 'old', name: 'ישנה', status: 'outgrown' }),
  ];

  async function renderBulk(fetchFn: FetchLike, enabled = true, monthlyCap = 300) {
    const data = closetWith(items());
    const closet = { ...data, ai: { ...data.ai, provider: 'openrouter' as const, analysis: { enabled, model: '', monthlyCap } } };
    const deviceStorage = withKey();
    const result = await renderWithCloset(
      <AiSettingsScreen deviceStorage={deviceStorage} imageDeps={fakeImageDeps()} />,
      closet,
      { deviceStorage, fetchFn },
    );
    return { ...result, panel: within(screen.getByRole('region', { name: 'זיהוי בגדים' })) };
  }

  it('shows what is known, asks first, sends the active unanalysed clothes and sums up', async () => {
    const user = userEvent.setup();
    const fetchFn = vi.fn<FetchLike>().mockImplementation(async () => goodAnswer());
    const { repo, panel } = await renderBulk(fetchFn);
    expect(panel.getByText('1 מזוהים · תמונה אחת לא ברורה')).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: 'לשלוח 2 בגדים לזיהוי' }));

    const sheet = within(screen.getByRole('dialog', { name: 'לשלוח 2 תמונות בגדים ל־AI?' }));
    expect(sheet.getByText(/כל בגד = בקשה אחת. נשארו החודש: 300/)).toBeInTheDocument();
    expect(fetchFn).not.toHaveBeenCalled();
    await user.click(sheet.getByRole('button', { name: 'כן, לשלוח' }));

    expect(await panel.findByText('2 זוהו')).toBeInTheDocument();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(repo.getData().items.find((it) => it.id === 'old')?.analysis).toBeNull();
    expect(panel.getByText('3 מזוהים · תמונה אחת לא ברורה')).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'כל הבגדים כבר נשלחו לזיהוי' })).toBeDisabled();
    await user.click(panel.getByRole('button', { name: 'סגירה' }));
    expect(panel.queryByText('2 זוהו')).not.toBeInTheDocument();
  });

  it('says when the cap will stop the run, and lets the parent change her mind', async () => {
    const user = userEvent.setup();
    const fetchFn = vi.fn<FetchLike>();
    const { panel } = await renderBulk(fetchFn, true, 1);
    await user.click(panel.getByRole('button', { name: 'לשלוח 2 בגדים לזיהוי' }));
    const sheet = within(screen.getByRole('dialog'));
    expect(sheet.getByText(/אחרי 1 הריצה תיעצר/)).toBeInTheDocument();
    await user.click(sheet.getByRole('button', { name: 'לא עכשיו' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('shows progress and stops after the current garment', async () => {
    const user = userEvent.setup();
    let reply: (r: Response) => void = () => undefined;
    const fetchFn = vi.fn<FetchLike>(() => new Promise<Response>((resolve) => (reply = resolve)));
    const { panel } = await renderBulk(fetchFn);
    await user.click(panel.getByRole('button', { name: 'לשלוח 2 בגדים לזיהוי' }));
    await user.click(screen.getByRole('button', { name: 'כן, לשלוח' }));
    expect(await panel.findByText('נשלחו 0 מתוך 2')).toBeInTheDocument();
    expect(panel.getByRole('progressbar', { name: 'שליחה לזיהוי' })).toHaveAttribute('aria-valuemax', '2');
    await user.click(panel.getByRole('button', { name: 'עצירה' }));
    expect(panel.getByRole('button', { name: 'עוצר אחרי הבגד הנוכחי…' })).toBeDisabled();
    await act(async () => reply(goodAnswer()));
    expect(await panel.findByText('1 זוהו')).toBeInTheDocument();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('stops on a problem every garment would hit, and explains each failure', async () => {
    const user = userEvent.setup();
    const fetchFn = vi.fn<FetchLike>().mockImplementation(async () => Response.json({ error: { message: 'Insufficient credits' } }, { status: 402 }));
    const { panel } = await renderBulk(fetchFn);
    await user.click(panel.getByRole('button', { name: 'לשלוח 2 בגדים לזיהוי' }));
    await user.click(screen.getByRole('button', { name: 'כן, לשלוח' }));
    expect(await panel.findByText('0 זוהו · 1 נכשלו')).toBeInTheDocument();
    expect(panel.getByText(/הריצה נעצרה: נגמר הקרדיט/)).toBeInTheDocument();
    const failure = panel.getByText(/חולצה א: נגמר הקרדיט/);
    expect(within(failure).getByText('402 Insufficient credits')).toHaveAttribute('dir', 'ltr');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('can only send while analysis is on', async () => {
    const { panel } = await renderBulk(vi.fn<FetchLike>(), false);
    expect(panel.getByRole('button', { name: 'לשלוח 2 בגדים לזיהוי' })).toBeDisabled();
    expect(panel.getByText('צריך להפעיל את זיהוי הבגדים כדי לשלוח.')).toBeInTheDocument();
  });

  it("shows this month's analyses in the parent panel while analysis is on", async () => {
    const storage = memoryStorage({ [`${AI_KEY_PREFIX}venice`]: 'k', [AI_ANALYSIS_USAGE_KEY]: JSON.stringify({ month: '2026-10', count: 12 }) });
    await renderWithCloset(
      <AiPanel deviceStorage={storage} now={OCT} onOpen={vi.fn()} onOpenFix={vi.fn()} />,
      closetWithAi({ provider: 'venice', analysis: { enabled: true, model: '', monthlyCap: 300 } }),
      { deviceStorage: storage },
    );
    expect(screen.getByText('זיהוי בגדים החודש').nextElementSibling).toHaveTextContent('12 מתוך 300');
  });
});
