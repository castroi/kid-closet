import { GARMENT_PHOTO, expect, openApp, readOpfsFile, tab, test } from './fixtures';

test('a garment she adds is saved on the phone and is still there after the app reopens', async ({ page }) => {
  await openApp(page);
  await tab(page, 'הוספה').click();

  // The real photo pipeline: resize on a canvas, WebP through the WebAssembly encoder.
  await page.getByLabel('בחירת תמונה מהגלריה').setInputFiles(GARMENT_PHOTO);
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
  expect(saved.closet.items[0].image).toMatch(/^images\/[\w-]+\.(webp|jpg)$/);

  // Reopen the app: the garment and its photo come back from the files.
  await page.reload();
  await tab(page, 'הארון שלי').click();
  await expect(page.getByRole('button', { name: 'עריכת חולצה קצרה בצבע ורוד' })).toBeVisible();
  // The card's own photo (not the coloured placeholder shown when a photo can't be read).
  const photo = page.locator('.card img.garment[alt="חולצה קצרה בצבע ורוד"]');
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await photo.evaluate((img: HTMLImageElement) => Math.max(img.naturalWidth, img.naturalHeight))).toBeLessThanOrEqual(800);
});
