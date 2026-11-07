import { expect, openApp, test } from './fixtures';

// The other tests rely on this: no request may leave the machine, so none can reach a real AI provider.
test('nothing the page asks for outside the local server gets through', async ({ page }) => {
  await openApp(page);
  const outcome = await page.evaluate(async () => {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: 'Bearer e2e-guard' } });
      return `reached the network: ${response.status}`;
    } catch {
      return 'blocked';
    }
  });
  expect(outcome).toBe('blocked');
});
