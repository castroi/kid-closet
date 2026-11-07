import { expect, test } from '@playwright/test';

// Runs in the "chromium" project only (playwright.config.ts): service workers are most reliable there.
test('after one visit the app opens and works with no network', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'ניווט ראשי' })).toBeVisible();
  // The generated /sw.js pre-caches the whole build and claims the page once it's active.
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined, null, {
    timeout: 30_000,
  });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'ניווט ראשי' })).toBeVisible();

  // A screen that loads more of the build (the photo step) still works from the cache.
  await page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('button', { name: 'הוספה', exact: true }).click();
  await page.getByLabel('בחירת תמונה מהגלריה').setInputFiles('src/assets/sample-garment.webp');
  await expect(page.getByAltText('התמונה שנבחרה')).toBeVisible();
});
