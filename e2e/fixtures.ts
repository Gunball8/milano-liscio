/**
 * Every e2e test fails on a JavaScript error or a console error/warning, except the expected ones:
 * requests cut on purpose in airplane mode and GPU driver chatter from headless rendering.
 */
import { test as base, expect } from '@playwright/test';

const EXPECTED = [/Failed to load resource/, /ERR_INTERNET_DISCONNECTED/, /internal error/i, /GL Driver|GPU stall|ReadPixels/];
/**
 * Requests of the old document cut by a reload (WebKit reports them as failures: blob reads, glyph
 * ranges "Load failed (0)"): only tolerated while that navigation runs, until the new page has loaded.
 */
const RELOAD_NOISE = [/NotReadableError/, /due to access control checks/, /AJAXError: Load failed \(0\)/];

export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      let navigating = false;
      page.on('request', (r) => {
        if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navigating = true;
      });
      page.on('load', () => (navigating = false));
      const report = (text: string) => {
        if (EXPECTED.some((r) => r.test(text))) return;
        if (navigating && RELOAD_NOISE.some((r) => r.test(text))) return;
        problems.push(text.slice(0, 300));
      };
      page.on('pageerror', (e) => report(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') report(`${m.type()}: ${m.text()}`);
      });
      await use();
      expect(problems, 'console errors or warnings during the test').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
