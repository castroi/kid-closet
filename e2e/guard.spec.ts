import { expect, openApp, test } from './fixtures';

// The other tests rely on this: no request may leave the machine, so none can reach a real AI provider.
test('nothing the page asks for outside the local server gets through', async ({ page }) => {
  await openApp(page);
  const outcome = await page.evaluate(async () => {
    try {
      // no-cors: any answer from the network resolves (as an opaque response), so only a request
      // that never left the machine rejects. A CORS refusal can't pass for "blocked".
      await fetch('https://openrouter.ai/api/v1/key', { mode: 'no-cors' });
      return 'reached the network';
    } catch {
      return 'blocked';
    }
  });
  expect(outcome).toBe('blocked');
});
