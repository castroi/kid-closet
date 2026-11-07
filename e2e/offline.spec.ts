import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test } from '@playwright/test';

/*
 * Runs in the "chromium" project only (playwright.config.ts): service workers are most reliable there.
 * No network is made the plain way: the test runs its own preview server and stops it. Playwright's
 * own tools for this (context.setOffline, or failing requests with a route) also change how Chromium
 * treats the worker's answers, so they can't tell whether the app itself works offline.
 */
const PORT = 4174;
const ORIGIN = `http://localhost:${PORT}`;

async function startServer(): Promise<ChildProcess> {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(ORIGIN)).ok) return server;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  stopServer(server);
  throw new Error(`the preview server on port ${PORT} didn't start`);
}

function stopServer(server: ChildProcess): void {
  // npx starts vite as a child: stop the whole group.
  if (server.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

async function serverIsDown(): Promise<boolean> {
  try {
    await fetch(ORIGIN);
    return false;
  } catch {
    return true;
  }
}

test('after one visit the app opens and works with no network', async ({ page }) => {
  const server = await startServer();
  try {
    await page.goto(ORIGIN);
    const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });
    await expect(nav).toBeVisible();
    // The generated /sw.js pre-caches the whole build and claims the page once it's active.
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });

    stopServer(server);
    await expect.poll(serverIsDown, { message: 'the preview server stopped' }).toBe(true);

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

    // A screen that loads more of the build (the photo step) still works from the cache.
    await nav.getByRole('button', { name: 'הוספה', exact: true }).click();
    await page.getByLabel('בחירת תמונה מהגלריה').setInputFiles('src/assets/sample-garment.webp');
    await expect(page.getByAltText('התמונה שנבחרה')).toBeVisible();
  } finally {
    stopServer(server);
  }
});
