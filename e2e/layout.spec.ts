import { expect, openApp, tab, test } from './fixtures';

/*
 * The iPhone projects use Playwright's device viewports, which are the screen minus Safari's
 * bars (e.g. 430×739 on a 430×932 screen). So "fits the viewport" here means "fits above
 * Safari's address bar". Playwright can't show the bar collapsing, the notch or the home
 * indicator (env(safe-area-inset-*) is 0 here): check those once on the iOS Simulator or her phone.
 */

const TABS = ['להתלבש', 'מועדפים', 'הארון שלי', 'הוספה'] as const;

for (const name of TABS) {
  test(`"${name}" fits the screen, right to left, with 44 px touch targets`, async ({ page }) => {
    await openApp(page);
    await tab(page, name).click();
    await expect(tab(page, name)).toHaveAttribute('aria-current', 'page');

    const box = await page.evaluate(() => {
      const nav = document.querySelector('nav.tabbar')!.getBoundingClientRect();
      const bar = document.querySelector('.action-bar')?.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        viewportWidth: document.documentElement.clientWidth,
        pageHeight: document.documentElement.scrollHeight,
        pageWidth: document.documentElement.scrollWidth,
        navTop: nav.top,
        navBottom: nav.bottom,
        actionBarBottom: bar ? bar.bottom : null,
        dir: document.querySelector('.app')?.getAttribute('dir'),
      };
    });

    expect(box.dir).toBe('rtl');
    // The tab bar is fully on screen, never under Safari's bar.
    expect(box.navTop).toBeGreaterThan(0);
    expect(box.navBottom).toBeLessThanOrEqual(box.viewportHeight + 0.5);
    if (box.actionBarBottom !== null) expect(box.actionBarBottom).toBeLessThanOrEqual(box.navTop + 0.5);
    // Only the screen's own area scrolls; the page itself never scrolls either way.
    expect(box.pageHeight).toBeLessThanOrEqual(box.viewportHeight + 1);
    expect(box.pageWidth).toBeLessThanOrEqual(box.viewportWidth);

    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          'button, a[href], [role="button"], label.file-btn, input:not([type="file"]):not([type="hidden"]), select, textarea',
        ),
      ]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        })
        .map((el) => {
          const r = el.getBoundingClientRect();
          const what = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40);
          return { what, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
        })
        .filter((t) => t.width < 43.5 || t.height < 43.5),
    );
    expect(small, 'touch targets smaller than 44 px').toEqual([]);
  });
}
