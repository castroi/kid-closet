import type { Page } from '@playwright/test';
import { expect, openApp, seedClothes, test } from './fixtures';

/*
 * "לראות את הלוק" is the dress-up screen's main button. It is pinned above the tab bar, so she never
 * has to scroll to find it, whatever the weather, the rows or the phone.
 */

type Closet = 'with a top layer' | 'no top layers yet' | 'empty';

const STATES: { weather: 'קר' | 'חם'; closet: Closet; button: string }[] = [
  { weather: 'קר', closet: 'with a top layer', button: 'לראות את הלוק' },
  { weather: 'קר', closet: 'no top layers yet', button: 'לראות את הלוק' },
  { weather: 'חם', closet: 'with a top layer', button: 'לראות את הלוק' },
  { weather: 'קר', closet: 'empty', button: 'צריך לבחור חולצה ומכנסיים' },
];

async function openDressUp(page: Page, weather: 'קר' | 'חם', closet: Closet): Promise<void> {
  await openApp(page);
  if (closet !== 'empty') await seedClothes(page, { layer: closet === 'with a top layer' });
  // The default weather depends on the month; set it.
  await page.getByRole('group', { name: 'מזג אוויר' }).getByRole('button', { name: weather }).click();
}

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  expect(b, selector).not.toBeNull();
  return b!;
}

for (const { weather, closet, button } of STATES) {
  test(`"${button}" is on screen above the tabs without scrolling (${weather}, ${closet})`, async ({ page }) => {
    await openDressUp(page, weather, closet);
    const cta = page.locator('.action-bar').getByRole('button', { name: button });
    await expect(cta).toBeVisible();
    if (closet === 'empty') await expect(cta).toBeDisabled();

    const viewport = page.viewportSize()!;
    const ctaBox = (await cta.boundingBox())!;
    const nav = await box(page, 'nav.tabbar');
    expect(ctaBox.y).toBeGreaterThanOrEqual(0);
    expect(ctaBox.y + ctaBox.height).toBeLessThanOrEqual(nav.y + 0.5);
    expect(nav.y + nav.height).toBeLessThanOrEqual(viewport.height + 0.5);
    expect(ctaBox.height).toBeGreaterThanOrEqual(44);
    // Not part of the scrolling rows: nothing was scrolled to bring it into view.
    expect(await page.locator('.screen').evaluate((el) => el.scrollTop)).toBe(0);

    if (closet === 'no top layers yet') {
      // One short line instead of a big empty box.
      const layerRow = page.getByRole('region', { name: 'שכבה עליונה' });
      await expect(layerRow.getByText('עוד אין שכבות · מוסיפים ב״הוספה״')).toBeVisible();
      expect((await layerRow.boundingBox())!.height).toBeLessThanOrEqual(80);
    }
  });
}

// The visible area of her phone in the owner's screenshot (iPhone, 402 pt wide, 708 pt above the tab bar).
test('on her phone, cold with a top layer, all three garments fit above the button', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-pro-max', 'one phone size is enough; this one sets its own viewport');
  await page.setViewportSize({ width: 402, height: 770 });
  await openDressUp(page, 'קר', 'with a top layer');
  await expect(page.locator('.screen')).toHaveClass(/screen-compact/);

  const bar = await box(page, '.action-bar');
  for (const name of ['סוודר בצבע כחול', 'חולצה קצרה בצבע ורוד', 'מכנסיים ארוכים בצבע שחור']) {
    const label = page.locator('.garment-name', { hasText: name });
    await expect(label).toBeVisible();
    const b = (await label.boundingBox())!;
    expect(b.y + b.height, `"${name}" ends above the button bar`).toBeLessThanOrEqual(bar.y + 0.5);
  }
});
