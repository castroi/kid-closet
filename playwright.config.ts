import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/**
 * Chromium only: the offline test (service workers are most reliable there under Playwright) and
 * the AI tests, because Playwright's WebKit on Linux doesn't intercept the provider's cross-origin
 * call, so it can't be answered by a fake provider there (it is still blocked, see e2e/fixtures.ts).
 */
const CHROMIUM_ONLY = /(offline|ai)\.spec/;

/**
 * End-to-end tests against the production build (`vite preview`), in the browsers jsdom can't
 * stand in for: real OPFS and its write worker, the WebP encoder, the service worker, layout.
 * Her phone is Safari, so the iPhone projects run WebKit.
 * Run `npm run build` first (CI does); `npm run test:e2e` does both.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'he-IL',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // The smallest and the largest iPhone screen she might use.
    { name: 'iphone-se', use: { ...devices['iPhone SE'] }, testIgnore: CHROMIUM_ONLY },
    { name: 'iphone-pro-max', use: { ...devices['iPhone 15 Pro Max'] }, testIgnore: CHROMIUM_ONLY },
    { name: 'chromium', use: { ...devices['Pixel 7'] }, testMatch: [CHROMIUM_ONLY, /guard\.spec/] },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
