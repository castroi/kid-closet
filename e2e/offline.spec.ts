import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';

/*
 * Runs in the "chromium" project only (playwright.config.ts): service workers are most reliable there.
 * No network is made the plain way: the test runs its own preview server and stops it. Playwright's
 * own tools for this (context.setOffline, or failing requests with a route) also change how Chromium
 * treats the worker's answers, so they can't tell whether the app itself works offline.
 */
const PORT = 4174;
const ORIGIN = `http://localhost:${PORT}`;

async function answers(): Promise<boolean> {
  try {
    await fetch(ORIGIN);
    return true;
  } catch {
    return false;
  }
}

/** A preview server of this test's own, stopped by the test and, whatever happens, at teardown. */
const test = base.extend<{ server: { stop: () => Promise<void> } }>({
  // No route here (it would change how Chromium treats the worker), so the hard stop of
  // e2e/fixtures.ts only: everything but localhost goes to a proxy that isn't there.
  proxy: { server: 'http://127.0.0.1:9', bypass: 'localhost,127.0.0.1' },
  // Playwright needs the object pattern even when a fixture uses no other fixture.
  // eslint-disable-next-line no-empty-pattern
  server: async ({}, use) => {
    if (await answers()) throw new Error(`port ${PORT} is already in use; stop whatever runs there`);
    // vite itself, not through npx, so this is the one process to stop.
    const child: ChildProcess = spawn(process.execPath, [path.join(process.cwd(), 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], {
      stdio: 'ignore',
    });
    let exited = false;
    const gone = new Promise<void>((resolve) =>
      child.once('exit', () => {
        exited = true;
        resolve();
      }),
    );
    for (let i = 0; !(await answers()); i++) {
      if (exited) throw new Error(`the preview server on port ${PORT} exited before it answered`);
      if (i >= 100) {
        child.kill();
        throw new Error(`the preview server on port ${PORT} didn't start`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    const stop = async () => {
      if (!exited) child.kill();
      await gone;
    };
    await use({ stop });
    await stop();
  },
});

test('after one visit the app opens and works with no network', async ({ page, server }) => {
  // Up to 30 s for the worker, plus the server and the offline start.
  test.setTimeout(90_000);
  await page.goto(ORIGIN);
  const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });
  await expect(nav).toBeVisible();
  // The generated /sw.js pre-caches the whole build and claims the page once it's active.
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });

  await server.stop();
  expect(await answers(), 'the preview server stopped').toBe(false);

  const logs: string[] = [];
  page.on('requestfailed', (r) => logs.push(`failed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.reload();
  try {
    // The worker waits up to 3 s for the network before it shows the cached page.
    await expect(nav).toBeVisible({ timeout: 15_000 });
  } catch {
    const shown = (await page.locator('body').innerText().catch(() => '')).trim().slice(0, 300);
    // Why the worker's cache didn't answer: is the script there, and does its Vary header get in the way?
    const cache = await page
      .evaluate(async () => {
        const src = [...document.scripts].map((s) => s.src).find((s) => s.includes('/assets/')) ?? '';
        const asPage = new Request(src, { mode: 'cors', credentials: 'same-origin' });
        const plain = await caches.match(src);
        return {
          src,
          match: !!plain,
          matchAsPage: !!(await caches.match(asPage)),
          matchIgnoringVary: !!(await caches.match(asPage, { ignoreVary: true })),
          vary: plain?.headers.get('vary') ?? null,
        };
      })
      .catch((e: Error) => ({ error: e.message }));
    throw new Error(
      `The app didn't open offline. The page shows: ${shown || '(nothing)'}\n${logs.join(' | ') || 'no failed requests'}\nCache: ${JSON.stringify(cache)}`,
    );
  }

  // The photo step works from the cache too, WebP encoder (.wasm) included: not the JPEG fallback.
  await nav.getByRole('button', { name: 'הוספה', exact: true }).click();
  await page.getByLabel('בחירת תמונה מהגלריה').setInputFiles('src/assets/sample-garment.webp');
  const preview = page.getByAltText('התמונה שנבחרה');
  await expect(preview).toBeVisible();
  const type = await preview.evaluate(async (img: HTMLImageElement) => (await (await fetch(img.src)).blob()).type);
  expect(type).toBe('image/webp');
});
