import { expect, openApp, seedClothes, test } from './fixtures';

/*
 * A tap on a dress-up photo shows it big, for checking real colours; it never changes her pick.
 * Dark theme on purpose: the photo must not be dimmed or filtered there either.
 */
test('a tap shows the photo big and undimmed; closing keeps her pick; a swipe still changes the shirt', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await seedClothes(page);
  await page.getByRole('group', { name: 'מזג אוויר' }).getByRole('button', { name: 'חם' }).click();

  const shirts = page.getByRole('region', { name: 'חולצה' });
  const photo = shirts.getByRole('button', { name: /^הגדלת התמונה: / });
  const shown = async () => (await photo.getAttribute('aria-label'))!.replace('הגדלת התמונה: ', '');
  const before = await shown();

  await photo.click();
  const view = page.getByRole('dialog', { name: before });
  await expect(view).toBeVisible();
  const img = view.getByRole('img', { name: before });
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);

  // Big: much bigger than the row's photo, and fully on screen.
  const viewport = page.viewportSize()!;
  const box = (await img.boundingBox())!;
  expect(Math.max(box.width, box.height)).toBeGreaterThan(viewport.width * 0.6);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  // Never dimmed or filtered, in the dark theme too.
  const look = await img.evaluate((el) => {
    let filtered = false;
    for (let node: Element | null = el; node; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.filter !== 'none' || Number(s.opacity) < 1) filtered = true;
    }
    return { dark: matchMedia('(prefers-color-scheme: dark)').matches, filtered };
  });
  expect(look.dark).toBe(true);
  expect(look.filtered).toBe(false);

  const close = view.getByRole('button', { name: 'סגירה' });
  const closeBox = (await close.boundingBox())!;
  expect(closeBox.width).toBeGreaterThanOrEqual(44);
  expect(closeBox.height).toBeGreaterThanOrEqual(44);
  await close.click();
  await expect(view).toHaveCount(0);
  expect(await shown()).toBe(before);

  // A sideways swipe on the photo changes the shirt and opens nothing.
  const p = (await photo.boundingBox())!;
  await page.mouse.move(p.x + p.width / 2 + 40, p.y + p.height / 2);
  await page.mouse.down();
  await page.mouse.move(p.x + p.width / 2 - 40, p.y + p.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(shown).not.toBe(before);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
