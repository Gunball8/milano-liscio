/**
 * Data update: files that did not change (same name, size, SHA-256) are copied from the installed
 * version instead of downloaded again. The next version is simulated by the same files under a new
 * version name.
 */
import { expect, test } from './fixtures.ts';
import { firstLaunch, waitForMap, waitForState } from './helpers.ts';

test('a data update copies unchanged files instead of downloading them', async ({ page }) => {
  await firstLaunch(page);
  await waitForState(page, '!!s.remote && !!s.installed');
  const before = await page.evaluate(() => (window as unknown as { __liscio: { getState(): { installed: { version: string } } } }).__liscio.getState().installed.version);

  const fetched: string[] = [];
  page.on('request', (r) => {
    if (/\/data\/milano[^/?]*\?v=/.test(r.url())) fetched.push(r.url());
  });

  await page.getByRole('button', { name: /^Menu/ }).click();
  await page.getByRole('button', { name: /^Données/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Données' });
  await expect(sheet).toBeVisible();
  await page.evaluate(() => {
    const store = (window as unknown as { __liscio: { getState(): { installed: { version: string; builtAt: string } }; setState(p: object): void } }).__liscio;
    const m = store.getState().installed;
    store.setState({ remote: { ...m, version: `${m.version}-next`, builtAt: new Date(Date.parse(m.builtAt) + 60_000).toISOString() } });
  });
  await expect(sheet).toContainText('≈ 0,0 Mo à télécharger');
  await sheet.getByRole('button', { name: 'Mettre à jour' }).click();
  await waitForState(page, `s.installed.version === '${before}-next' && !s.updating`);
  expect(fetched).toEqual([]);

  // The map reloads on the new version, then the old one is removed.
  await waitForMap(page);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('data-')))).toEqual([`data-${before}-next`]);
});
