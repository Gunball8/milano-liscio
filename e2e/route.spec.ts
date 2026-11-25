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

/** The single level choice: four cards, each with that level's distance and pavé on this trip. */
const alternatives = (page: Page) => page.getByRole('radiogroup', { name: 'Tolérance au détour' }).getByRole('radio');

test('offline: search a street and get the three alternatives with their statistics', async ({ page }, info) => {
  await firstLaunch(page);
  await goOfflineAndRelaunch(page);

  // Arrival typed with a typo, departure = "Ma position" (mocked GPS at the Duomo).
  await search(page, 'Arrivée', 'corso magneta', /Corso Magenta/);
  const panel = page.getByRole('region', { name: 'Itinéraire' });
  await expect(alternatives(page)).toHaveCount(4);
  for (const [i, name] of ['Court', 'Équilibré', 'Lisse', 'Zéro pavé'].entries()) {
    await expect(alternatives(page).nth(i)).toHaveAccessibleName(new RegExp(`^${name} : [\\d,]+\\s(km|m), \\d+\\sm de pavé$`));
  }
  await expect(alternatives(page).nth(2)).toHaveAttribute('aria-checked', 'true'); // Lisse by default
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

  // One choice: tapping a level selects it at once (all four are computed).
  await alternatives(page).nth(0).click();
  await expect(alternatives(page).nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(panel).toContainText('le plus court');
  await alternatives(page).nth(3).click();
  await expect(alternatives(page).nth(3)).toHaveAttribute('aria-checked', 'true');
  await expect(alternatives(page)).toHaveCount(4);

  // Departure searched by alias, arrival by pasted coordinates.
  await search(page, 'Départ', 'stazione centrale', /Milano Centrale/);
  await expect(page.getByRole('button', { name: /^Départ : Milano Centrale/ })).toBeVisible();
  await search(page, 'Arrivée', '45.4520, 9.1770', /Coordonnées/);
  await expect(alternatives(page)).toHaveCount(4);
  await expect(alternatives(page).nth(3)).toHaveAttribute('aria-checked', 'true'); // the choice is remembered
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
  await expect(page.getByRole('button', { name: 'Favori Bureau' })).toBeVisible();

  await page.reload();
  await waitForMap(page);
  await expect(page.getByRole('button', { name: 'Favori Bureau' })).toBeVisible();
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

test('favourite destinations: star on the arrival and in search results, kept on the phone', async ({ page }) => {
  await firstLaunch(page);
  await page.waitForFunction(() => (window as unknown as { __liscio: { getState(): { engine: string } } }).__liscio.getState().engine === 'ready', null, { timeout: 30_000 });
  await search(page, 'Arrivée', 'corso magenta', /Corso Magenta/);
  await page.getByRole('button', { name: 'Ajouter Corso Magenta aux favoris' }).click();
  await expect(page.getByRole('button', { name: 'Favori Corso Magenta' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retirer Corso Magenta des favoris' })).toHaveAttribute('aria-pressed', 'true');

  // Star straight from the search results.
  await page.getByRole('button', { name: /^Arrivée/ }).click();
  await page.getByRole('searchbox', { name: 'Rechercher une adresse' }).fill('stazione centrale');
  await page.getByRole('button', { name: 'Ajouter Milano Centrale aux favoris' }).click();
  await expect(page.getByRole('button', { name: 'Retirer Milano Centrale des favoris' })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByRole('button', { name: 'Favori Milano Centrale' })).toBeVisible();

  // Stored on the device: still there after a relaunch; a favourite chip routes to it.
  await page.reload();
  await waitForMap(page);
  await page.getByRole('button', { name: 'Favori Milano Centrale' }).click();
  await expect(page.getByRole('button', { name: /^Arrivée : Milano Centrale/ })).toBeVisible();
  await expect(alternatives(page)).toHaveCount(4);

  // Removing from the arrival star.
  await page.getByRole('button', { name: 'Retirer Milano Centrale des favoris' }).click();
  await expect(page.getByRole('button', { name: 'Favori Milano Centrale' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Favori Corso Magenta' })).toBeVisible();
});

test('the position arrow follows where the phone points', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'orientation events are only injectable in Chromium');
  // Like answering the sensor prompt (DeviceOrientationEvent.requestPermission) with "Autoriser".
  await page.context().grantPermissions(['geolocation', 'accelerometer', 'gyroscope', 'magnetometer']);
  await firstLaunch(page);
  await page.getByRole('button', { name: 'Me localiser' }).click();
  const heading = () =>
    page.evaluate(() => {
      const m = (window as unknown as { __map: { querySourceFeatures(s: string): { properties: { heading: number } }[] } }).__map;
      return m.querySourceFeatures('liscio-me')[0]?.properties.heading ?? null;
    });
  await expect.poll(heading).toBe(-1); // located, no direction yet: dot
  await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 90, beta: 0, gamma: 0, absolute: true })));
  await expect.poll(heading).toBeCloseTo(270, 0); // alpha is counter-clockwise: 90° → heading 270° (west)
});
