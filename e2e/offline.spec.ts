/**
 * Phase 2 acceptance (SPEC §11): after a first load, airplane mode, relaunch → map and labels show
 * over the whole zone. Relaunch is a reload at the start URL; offline is emulated by the browser.
 */
import { expect, test } from './fixtures.ts';
import { firstLaunch, probe, waitForMap, zonePoints } from './helpers.ts';

test('offline relaunch shows the map and its labels over the whole zone', async ({ page, context }, info) => {
  await firstLaunch(page);

  // The service worker must control the page (shell, fonts and sprites precached) before going offline.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);

  await context.setOffline(true);
  const failed: string[] = [];
  page.on('requestfailed', (r) => {
    if (!r.url().endsWith('/data/manifest.json')) failed.push(`${r.url()} (${r.failure()?.errorText ?? ''})`);
  });
  await page.reload();
  await expect(page.getByRole('button', { name: /^Menu/ })).toBeVisible();
  await waitForMap(page);
  // Negative control: the network really is off (the manifest is never served from cache).
  const reach = await page.evaluate(() =>
    fetch(`${location.origin}/data/manifest.json`, { cache: 'no-store' }).then(
      () => 'online',
      () => 'offline',
    ),
  );
  expect(reach).toBe('offline');

  for (const [name, lon, lat] of await zonePoints(page)) {
    const r = await probe(page, lon, lat);
    expect.soft(r.features, `${name}: basemap features`).toBeGreaterThan(50);
    expect.soft(r.labels, `${name}: labels`).toBeGreaterThan(0);
  }
  await probe(page, 9.1919, 45.4641, 15);
  await page.screenshot({ path: info.outputPath('offline-duomo.png') });
  expect(failed).toEqual([]);
});
