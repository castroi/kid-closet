import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';

/** A real garment photo that ships with the app (the one "בדיקת זיהוי" sends). */
export const GARMENT_PHOTO = path.join(process.cwd(), 'src/assets/sample-garment.webp');

/**
 * Every test gets a fresh browser context, so a fresh, empty OPFS and localStorage.
 * Nothing may leave the machine: any request that isn't to the local preview server is
 * aborted, so a test can never reach a real AI provider. A test that wants a provider
 * answer adds its own `page.route`, which takes precedence over this one.
 */
export const test = base.extend({
  // WebKit's default (ephemeral) context is like a Safari private tab: OPFS refuses access with
  // UnknownError. So each test gets a persistent profile in its own new folder: real storage,
  // still empty and unshared, like a fresh install.
  context: async ({ playwright, browserName, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, baseURL }, use, testInfo) => {
    const screen = (testInfo.project.use as { screen?: { width: number; height: number } }).screen;
    // A plain ASCII folder: WebKit can't start with a profile path holding the Hebrew test title.
    const profile = await mkdtemp(path.join(tmpdir(), 'kid-closet-e2e-'));
    const context = await playwright[browserName].launchPersistentContext(profile, {
      viewport,
      screen,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      locale,
      baseURL,
      // The hard stop: everything but the local server goes to a proxy that isn't there, so
      // nothing leaves the machine even if a route below is missed. A test's own page.route
      // still answers first, before the request reaches the network.
      proxy: { server: 'http://127.0.0.1:9', bypass: 'localhost,127.0.0.1' },
    });
    await context.route('**/*', (route) => {
      const { protocol, hostname } = new URL(route.request().url());
      const local = hostname === 'localhost' || hostname === '127.0.0.1' || protocol === 'blob:' || protocol === 'data:';
      return local ? route.fallback() : route.abort('blockedbyclient');
    });
    await use(context);
    await context.close();
    await rm(profile, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    // The profile's first page opened before the routes were set, so they may not apply to it:
    // use a page made after them, and close the first one.
    const page = await context.newPage();
    for (const other of context.pages()) if (other !== page) await other.close();
    await use(page);
  },
});

export { expect };

/** Opens the app and waits until the closet has loaded (the tab bar is shown). */
export async function openApp(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  try {
    await expect(page.getByRole('navigation', { name: 'ניווט ראשי' })).toBeVisible();
  } catch {
    // Say what she would see instead (the unsupported-browser or recovery screen, say).
    const shown = (await page.locator('body').innerText()).trim().slice(0, 500);
    throw new Error(`The app didn't open. The page shows: ${shown || '(nothing)'}\nPage errors: ${errors.join(' | ') || 'none'}`);
  }
}

export function tab(page: Page, name: 'להתלבש' | 'מועדפים' | 'הארון שלי' | 'הוספה') {
  return page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('button', { name, exact: true });
}

/**
 * Writes a file into this site's OPFS, the way the app's files sit on her phone ("closet-a.json",
 * "images/<id>.webp"). Text or bytes. Uses createWritable where the browser has it, otherwise a
 * worker's sync access handle (the only way older Safari writes OPFS files).
 */
export async function writeOpfsFile(page: Page, name: string, data: string | Buffer): Promise<void> {
  const payload = typeof data === 'string' ? { text: data, b64: null } : { text: null, b64: data.toString('base64') };
  const result = await page.evaluate(
    async ({ name, text, b64 }) => {
      const bytes = b64 === null ? new TextEncoder().encode(text ?? '') : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const parts = name.split('/');
      let dir = await navigator.storage.getDirectory();
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
      const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      if (typeof handle.createWritable === 'function') {
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
        return 'ok';
      }
      const source = `onmessage = async (e) => {
        try {
          let dir = await navigator.storage.getDirectory();
          const parts = e.data.name.split('/');
          for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
          const h = await dir.getFileHandle(parts[parts.length - 1], { create: true });
          const a = await h.createSyncAccessHandle();
          a.truncate(0);
          a.write(e.data.bytes, { at: 0 });
          a.flush();
          a.close();
          postMessage('ok');
        } catch (err) {
          postMessage(String(err));
        }
      };`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(url);
      try {
        return await new Promise<string>((resolve) => {
          worker.onmessage = (e) => resolve(String(e.data));
          worker.onerror = (e) => resolve(e.message);
          worker.postMessage({ name, bytes });
        });
      } finally {
        worker.terminate();
        URL.revokeObjectURL(url);
      }
    },
    { name, ...payload },
  );
  expect(result, `writing ${name} into OPFS`).toBe('ok');
}

/** Reads a file at the top of this site's OPFS, or null when it isn't there. */
export async function readOpfsFile(page: Page, name: string): Promise<string | null> {
  return page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    try {
      return await (await (await root.getFileHandle(name)).getFile()).text();
    } catch {
      return null;
    }
  }, name);
}

/**
 * Saves a closet file as the app would (schema 5), with a high generation so it outranks
 * anything the app wrote on its first start, then reloads so the app reads it.
 */
export async function seedCloset(page: Page, closet: Record<string, unknown>): Promise<void> {
  const envelope = {
    generation: 50,
    savedAt: new Date().toISOString(),
    closet: {
      schemaVersion: 5,
      items: [],
      outfits: [],
      lastBackupAt: null,
      doll: { id: 'default', image: null },
      ai: {
        provider: null,
        model: '',
        prompt: null,
        monthlyCap: 100,
        analysis: { enabled: false, model: '', monthlyCap: 300 },
      },
      aiLooks: [],
      ...closet,
    },
  };
  await writeOpfsFile(page, 'closet-a.json', JSON.stringify(envelope));
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'ניווט ראשי' })).toBeVisible();
}

/**
 * A closet as she uses it: an outer layer (unless `layer: false`), two shirts and trousers, each
 * with a real photo file, and one saved outfit. So screens show their rows, cards and favourites, not only
 * their empty states.
 */
export async function seedClothes(page: Page, { layer = true }: { layer?: boolean } = {}): Promise<void> {
  const photo = readFileSync(GARMENT_PHOTO);
  const at = '2026-10-01T08:00:00.000Z';
  const garments = [
    ...(layer ? [{ id: 'e2e-sweater', name: 'סוודר בצבע כחול', type: 'sweater', colorGroup: 'blue' }] : []),
    { id: 'e2e-tee', name: 'חולצה קצרה בצבע ורוד', type: 'tee', colorGroup: 'pink' },
    { id: 'e2e-long', name: 'חולצה ארוכה בצבע ירוק', type: 'longTop', colorGroup: 'green' },
    { id: 'e2e-pants', name: 'מכנסיים ארוכים בצבע שחור', type: 'pants', colorGroup: 'black' },
  ];
  for (const g of garments) await writeOpfsFile(page, `images/${g.id}.webp`, photo);
  await seedCloset(page, {
    items: garments.map((g) => ({
      ...g,
      occasions: ['school', 'casual', 'party'],
      status: 'active',
      image: `images/${g.id}.webp`,
      photoRevision: 0,
      analysis: null,
      createdAt: at,
      updatedAt: at,
    })),
    outfits: [{ id: 'e2e-outfit', occasion: 'school', layerId: layer ? 'e2e-sweater' : null, topId: 'e2e-tee', bottomId: 'e2e-pants', createdAt: at }],
  });
}
