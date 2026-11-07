import type { Page } from '@playwright/test';
import { expect, openApp, readOpfsFile, tab, test } from './fixtures';

/** A 1600×1200 PNG made in the page, bigger than the 800 px the app must resize to, like a phone photo. */
async function bigPhoto(page: Page): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const b64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1200;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f4a7b9';
    ctx.fillRect(0, 0, 1600, 1200);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(500, 300, 600, 600);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return { name: 'IMG_0001.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

test('a garment she adds is saved on the phone and is still there after the app reopens', async ({ page }) => {
  await openApp(page);
  await tab(page, 'הוספה').click();

  // The real photo pipeline: resize on a canvas, WebP through the WebAssembly encoder.
  await page.getByLabel('בחירת תמונה מהגלריה').setInputFiles(await bigPhoto(page));
  await expect(page.getByAltText('התמונה שנבחרה')).toBeVisible();

  await page.getByRole('button', { name: 'חולצה קצרה', exact: true }).click();
  await page.getByRole('button', { name: 'בית ספר', exact: true }).click();
  await page.getByRole('button', { name: 'ורוד', exact: true }).click();
  await page.getByRole('button', { name: 'שמירה בארון' }).click();
  await expect(page.getByText('"חולצה קצרה בצבע ורוד" נשמר בארון')).toBeVisible();

  // Saved through the real OPFS write worker: a closet file and the photo file.
  const closetFile = (await readOpfsFile(page, 'closet-a.json')) ?? (await readOpfsFile(page, 'closet-b.json'));
  expect(closetFile, 'a closet file in OPFS').not.toBeNull();
  const saved = JSON.parse(closetFile!) as { closet: { items: { name: string; image: string }[] } };
  expect(saved.closet.items.map((it) => it.name)).toEqual(['חולצה קצרה בצבע ורוד']);
  // WebP, not the JPEG fallback: the encoder really ran (Safari can't encode WebP itself).
  expect(saved.closet.items[0].image).toMatch(/^images\/[\w-]+\.webp$/);

  // Reopen the app: the garment and its photo come back from the files.
  await page.reload();
  await tab(page, 'הארון שלי').click();
  await expect(page.getByRole('button', { name: 'עריכת חולצה קצרה בצבע ורוד' })).toBeVisible();
  // The card's own photo (not the coloured placeholder shown when a photo can't be read).
  const photo = page.locator('.card img.garment[alt="חולצה קצרה בצבע ורוד"]');
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  // Resized on the phone to 800 px on the longest side, keeping its shape.
  const size = await photo.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(size).toEqual([800, 600]);
});
