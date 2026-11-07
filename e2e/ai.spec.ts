import type { Page, Route } from '@playwright/test';
import { GARMENT_PHOTO, expect, openApp, seedCloset, tab, test } from './fixtures';

const ANALYZE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const FAKE_KEY = 'sk-or-e2e-not-a-real-key';

/** What a vision model says about a short-sleeved pink t-shirt (the sample in src/test/data.ts). */
const PINK_TEE = {
  valid_image: true,
  category: 'top',
  subcategory: 't-shirt',
  primary_color: 'pink',
  primary_color_hex: '#D18197',
  secondary_colors: ['white'],
  color_family: 'colorful',
  pattern: 'graphic_print',
  graphic_description: 'small white circular graphic on the left chest',
  text_on_item: null,
  busyness: 'low',
  formality: ['play', 'school'],
  season: ['summer', 'mid'],
  warmth: 'light',
  sleeve_length: 'short',
  leg_length: null,
  material_guess: 'cotton',
  fit: 'regular',
  closure: 'none',
  style_tags: ['casual', 'everyday', 'comfy'],
  short_title: 'Pink graphic t-shirt',
  kid_friendly_description: 'A comfy pink t-shirt with a small white picture on the chest.',
  confidence: 'high',
  notes: null,
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
};

/** Garment analysis on, with OpenRouter and a key on this phone, as the parent area sets it up. */
async function setUpAnalysis(page: Page): Promise<void> {
  await openApp(page);
  await page.evaluate((key) => localStorage.setItem('kid-closet:ai-key:openrouter', key), FAKE_KEY);
  await seedCloset(page, {
    ai: {
      provider: 'openrouter',
      model: '',
      prompt: null,
      monthlyCap: 100,
      analysis: { enabled: true, model: '', monthlyCap: 300 },
    },
  });
  // The reloaded app read the seeded file: the parent's key is on this phone and the closet has a provider.
  expect(await page.evaluate(() => localStorage.getItem('kid-closet:ai-key:openrouter'))).toBe(FAKE_KEY);
}

/** Answers the analysis endpoint (and its CORS preflight) instead of OpenRouter; records what was sent. */
async function fakeProvider(page: Page, answer: (route: Route) => Promise<void>) {
  const sent: string[] = [];
  // What else happened, to explain a call that never came.
  const outside: string[] = [];
  const logs: string[] = [];
  page.on('request', (r) => {
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(r.url())) outside.push(`${r.method()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => outside.push(`failed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text());
  });
  await page.route(ANALYZE_URL, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    sent.push(route.request().headers()['authorization'] ?? '');
    return answer(route);
  });
  return {
    sent,
    async waitForCalls(n: number) {
      try {
        await expect.poll(() => sent.length, { timeout: 10_000 }).toBe(n);
      } catch {
        throw new Error(
          `expected ${n} call(s) to the provider, got ${sent.length}.\nOutside requests: ${outside.join(' | ') || 'none'}\nConsole: ${logs.join(' | ') || 'none'}\nPage: ${(await page.locator('body').innerText()).slice(0, 400)}`,
        );
      }
    },
  };
}

test('the AI fills type, colour and occasions from the photo, and she saves it', async ({ page }) => {
  await setUpAnalysis(page);
  const provider = await fakeProvider(page, (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(PINK_TEE) } }] }),
    }),
  );

  await tab(page, 'הוספה').click();
  await page.getByLabel('בחירת תמונה מהגלריה').setInputFiles(GARMENT_PHOTO);
  await provider.waitForCalls(1);
  await expect(page.getByText('ה־AI מילא את הפרטים · בדקי שהכול נכון')).toBeVisible();
  await expect(page.getByRole('button', { name: 'חולצה קצרה', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'בית ספר', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(provider.sent).toEqual([`Bearer ${FAKE_KEY}`]);

  // She still checks and presses save herself.
  await page.getByRole('button', { name: 'שמירה בארון' }).click();
  await expect(page.getByText('"חולצה קצרה בצבע ורוד" נשמר בארון')).toBeVisible();
  // The answer was stored with the garment, so it is never paid for twice.
  await tab(page, 'הארון שלי').click();
  await expect(page.getByRole('button', { name: 'עריכת חולצה קצרה בצבע ורוד · ה־AI מכיר' })).toBeVisible();
  expect(provider.sent).toHaveLength(1);
});

test('when the provider refuses the key, the kid sees no provider message and fills the form herself', async ({ page }) => {
  await setUpAnalysis(page);
  const provider = await fakeProvider(page, (route) =>
    route.fulfill({
      status: 401,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'No auth credentials found', code: 401 } }),
    }),
  );

  await tab(page, 'הוספה').click();
  await page.getByLabel('בחירת תמונה מהגלריה').setInputFiles(GARMENT_PHOTO);
  await expect(page.getByAltText('התמונה שנבחרה')).toBeVisible();
  await provider.waitForCalls(1);
  await expect(page.getByText('ה־AI מסתכל על הבגד…')).toHaveCount(0);

  await expect(page.getByText('No auth credentials found')).toHaveCount(0);
  await expect(page.getByText('401')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'חולצה קצרה', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('חסר: סוג, לאן לובשים, צבע')).toBeVisible();
});
