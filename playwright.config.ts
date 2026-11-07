import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/**
 * End-to-end tests against the production build (`vite preview`), in the browsers jsdom can't
 * stand in for: real OPFS and its write worker, the WebP encoder, the service worker, layout.
 * Her phone is Safari, so the iPhone projects run WebKit. Chromium runs only the offline test,
 * because service workers are most reliable there under Playwright.
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
    { name: 'iphone-se', use: { ...devices['iPhone SE'] }, testIgnore: /offline\.spec/ },
    { name: 'iphone-pro-max', use: { ...devices['iPhone 15 Pro Max'] }, testIgnore: /offline\.spec/ },
    { name: 'chromium', use: { ...devices['Pixel 7'] }, testMatch: /offline\.spec/ },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
