import { expect, openApp, readOpfsFile, test, writeOpfsFile } from './fixtures';

test('damaged closet files show the restore screen and are never overwritten', async ({ page }) => {
  await openApp(page);
  const damaged = '{"generation": 7, "closet": not json';
  await writeOpfsFile(page, 'closet-a.json', damaged);
  await writeOpfsFile(page, 'closet-b.json', damaged);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'לא הצלחנו לפתוח את הארון' })).toBeVisible();
  await expect(page.getByText('שחזור מגיבוי')).toBeVisible();
  // Never an empty closet started over her files.
  await expect(page.getByRole('navigation', { name: 'ניווט ראשי' })).toHaveCount(0);
  expect(await readOpfsFile(page, 'closet-a.json')).toBe(damaged);
  expect(await readOpfsFile(page, 'closet-b.json')).toBe(damaged);
});

test('a phone that refuses storage (a private tab) gets "no access", not "damaged files"', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.storage.getDirectory = () => Promise.reject(new DOMException('The operation is not supported.', 'UnknownError'));
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'אין גישה לאחסון בטלפון' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'לנסות שוב' })).toBeVisible();
  await expect(page.getByText('הקבצים בטלפון פגומים')).toHaveCount(0);
});
