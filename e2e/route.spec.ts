/**
 * Phase 3 acceptance (SPEC §11): in airplane mode, search a street, then see the three alternatives
 * and their statistics. Plus departure search, coordinates, level change, long press and favourites.
 */
import { type Page, expect, test } from '@playwright/test';
import { firstLaunch, waitForMap } from './helpers.ts';

test.use({ geolocation: { latitude: 45.4641, longitude: 9.19 }, permissions: ['geolocation'] });

async function goOfflineAndRelaunch(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
  await page.context().setOffline(true);
  await page.reload();
  await waitForMap(page);
  await page.waitForFunction(() => (window as unknown as { __liscio: { getState(): { engine: string } } }).__liscio.getState().engine === 'ready', null, { timeout: 30_000 });
}

async function search(page: Page, field: 'Départ' | 'Arrivée', query: string, pick: RegExp) {
  await page.getByRole('button', { name: new RegExp(`^${field}`) }).click();
  await page.getByRole('searchbox', { name: 'Rechercher une adresse' }).fill(query);
  const result = page.getByRole('list', { name: 'Résultats' }).getByRole('button', { name: pick }).first();
  await expect(result).toBeVisible();
  await result.click();
}

const alternatives = (page: Page) => page.getByRole('radiogroup', { name: 'Alternatives' }).getByRole('radio');

test('offline: search a street and get the three alternatives with their statistics', async ({ page }, info) => {
  await firstLaunch(page);
  await goOfflineAndRelaunch(page);

  // Arrival typed with a typo, departure = "Ma position" (mocked GPS at the Duomo).
  await search(page, 'Arrivée', 'corso magneta', /Corso Magenta/);
  const panel = page.getByRole('region', { name: 'Itinéraire' });
  await expect(alternatives(page)).toHaveCount(3);
  await expect(alternatives(page).nth(0)).toHaveAccessibleName(/^Court/);
  await expect(alternatives(page).nth(1)).toHaveAccessibleName(/^Lisse/);
  await expect(alternatives(page).nth(2)).toHaveAccessibleName(/^Zéro pavé/);
  await expect(panel).toContainText(/\d+(,\d+)?\s(km|m)/);
  await expect(panel).toContainText(/\d+\smin/);
  await expect(panel).toContainText('Pavé');
  await expect(panel).toContainText('Le long de rails');
  await expect(panel).toContainText('Croisements');
  await expect(panel).toContainText(/vs le plus court/);
  const drawn = await page.evaluate(() => {
    const m = (window as unknown as { __map: { queryRenderedFeatures(o: object): unknown[] } }).__map;
    return { main: m.queryRenderedFeatures({ layers: ['lr-main'] }).length, alt: m.queryRenderedFeatures({ layers: ['lr-alt'] }).length };
  });
  expect(drawn.main).toBeGreaterThan(0);
  expect(drawn.alt).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('route-offline.png') });

  // Tapping an alternative selects it.
  await alternatives(page).nth(0).click();
  await expect(alternatives(page).nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(panel).toContainText('le plus court');

  // Level 3 chosen: two alternatives remain (Court, Zéro pavé).
  await page.getByRole('radiogroup', { name: 'Tolérance au détour' }).getByRole('radio', { name: 'Zéro pavé' }).click();
  await expect(alternatives(page)).toHaveCount(2);

  // Departure searched by alias, arrival by pasted coordinates.
  await search(page, 'Départ', 'stazione centrale', /Milano Centrale/);
  await expect(page.getByRole('button', { name: /^Départ : Milano Centrale/ })).toBeVisible();
  await search(page, 'Arrivée', '45.4520, 9.1770', /Coordonnées/);
  await expect(alternatives(page)).toHaveCount(2);
});

test('long press: go here, favourites stored on the device', async ({ page }) => {
  await firstLaunch(page);
  await page.waitForFunction(() => (window as unknown as { __liscio: { getState(): { engine: string } } }).__liscio.getState().engine === 'ready', null, { timeout: 30_000 });
  const box = (await page.locator('.map').boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Aller ici' }).click();
  await expect(alternatives(page).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Arrivée : (Près de|Point sur la carte)/ })).toBeVisible();

  await page.mouse.click(at.x, at.y - 120, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Ajouter aux favoris' }).click();
  await page.getByRole('textbox', { name: 'Nom du favori' }).fill('Bureau');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('button', { name: '★ Bureau' })).toBeVisible();

  await page.reload();
  await waitForMap(page);
  await expect(page.getByRole('button', { name: '★ Bureau' })).toBeVisible();
});

test('a real touch long press opens the menu, a short tap does not', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'touch events are injected through the Chromium DevTools protocol');
  await firstLaunch(page);
  const box = (await page.locator('.map').boundingBox())!;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const cdp = await page.context().newCDPSession(page);
  const touch = async (holdMs: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(holdMs);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await touch(150);
  await page.waitForTimeout(700);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await touch(750);
  await expect(page.getByRole('menuitem', { name: 'Partir d\'ici' })).toBeVisible();
});
