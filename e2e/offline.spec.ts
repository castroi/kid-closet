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
  await page.reload();
  try {
    // The worker waits up to 3 s for the network before it shows the cached page.
    await expect(nav).toBeVisible({ timeout: 15_000 });
  } catch {
    const shown = (await page.locator('body').innerText().catch(() => '')).trim().slice(0, 400);
    throw new Error(`The app didn't open offline. The page shows: ${shown || '(nothing)'} (url ${page.url()})`);
  }

  // A screen that loads more of the build (the photo step) still works from the cache.
  await nav.getByRole('button', { name: 'הוספה', exact: true }).click();
  await page.getByLabel('בחירת תמונה מהגלריה').setInputFiles('src/assets/sample-garment.webp');
  await expect(page.getByAltText('התמונה שנבחרה')).toBeVisible();
});
