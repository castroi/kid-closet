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
  context: async ({ context }, use) => {
    await context.route('**/*', (route) => {
      const { hostname } = new URL(route.request().url());
      return hostname === 'localhost' || hostname === '127.0.0.1' ? route.fallback() : route.abort('blockedbyclient');
    });
    await use(context);
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
 * Writes a file at the top of this site's OPFS, the way a closet file sits on her phone.
 * Uses createWritable where the browser has it, otherwise a worker's sync access handle
 * (the only way older Safari writes OPFS files).
 */
export async function writeOpfsFile(page: Page, name: string, text: string): Promise<void> {
  const result = await page.evaluate(
    async ({ name, text }) => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(name, { create: true });
      if (typeof handle.createWritable === 'function') {
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        return 'ok';
      }
      const source = `onmessage = async (e) => {
        try {
          const root = await navigator.storage.getDirectory();
          const h = await root.getFileHandle(e.data.name, { create: true });
          const a = await h.createSyncAccessHandle();
          a.truncate(0);
          a.write(new TextEncoder().encode(e.data.text), { at: 0 });
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
          worker.postMessage({ name, text });
        });
      } finally {
        worker.terminate();
        URL.revokeObjectURL(url);
      }
    },
    { name, text },
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
