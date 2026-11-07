import { expect, test } from '@playwright/test';

// Runs in the "chromium" project only (playwright.config.ts): service workers are most reliable there.
test('after one visit the app opens and works with no network', async ({ page, context }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });
  await expect(nav).toBeVisible();
  // The generated /sw.js pre-caches the whole build and claims the page once it's active.
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });

  // No network: every request fails, also the worker's own (Chromium routes those too), so
  // whatever opens must come from the worker's cache. (context.setOffline() also stopped the
  // worker from serving its cache in Chromium, which a phone without signal doesn't do.)
  await context.route('**/*', (route) => route.abort('internetdisconnected'));
  const failed: string[] = [];
  const logs: string[] = [];
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.reload();
  try {
    // The worker waits up to 3 s for the network before it shows the cached page.
    await expect(nav).toBeVisible({ timeout: 15_000 });
  } catch {
    const state = await page
      .evaluate(async () => {
        const keys = await caches.keys();
        const cached = keys.length ? (await (await caches.open(keys[0])).keys()).map((r) => new URL(r.url).pathname) : [];
        return {
          controlled: !!navigator.serviceWorker.controller,
          caches: keys,
          cached,
          scripts: [...document.scripts].map((s) => s.src || '(inline)'),
          root: document.getElementById('root')?.innerHTML.slice(0, 200) ?? '(no #root)',
        };
      })
      .catch((e: Error) => ({ error: e.message }));
    throw new Error(
      `The app didn't open offline.\nState: ${JSON.stringify(state)}\nFailed: ${failed.join(' | ') || 'none'}\nConsole: ${logs.join(' | ') || 'none'}`,
    );
  }

  // A screen that loads more of the build (the photo step) still works from the cache.
  await nav.getByRole('button', { name: 'הוספה', exact: true }).click();
  await page.getByLabel('בחירת תמונה מהגלריה').setInputFiles('src/assets/sample-garment.webp');
  await expect(page.getByAltText('התמונה שנבחרה')).toBeVisible();
});
