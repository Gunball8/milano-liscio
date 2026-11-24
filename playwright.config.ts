import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/** End-to-end tests (SPEC §12): iPhone viewport, WebKit first, Chromium as a second engine. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    { name: 'webkit-iphone', use: { ...devices['iPhone 15'] } },
    {
      name: 'chromium-iphone',
      use: { ...devices['iPhone 15'], browserName: 'chromium', launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } },
    },
  ],
});
