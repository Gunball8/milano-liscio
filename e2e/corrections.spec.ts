/**
 * Phase 5 acceptance (SPEC §11): marking a smooth street of the route as "Pavé" changes the level-2
 * route at the next calculation; export then import restores the corrections exactly.
 * Plus reports to sort and settings (SPEC §9.3, §9.4).
 */
import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import { firstLaunch, waitForMap, waitForState } from './helpers.ts';

test.use({ geolocation: { latitude: 45.4641, longitude: 9.19, accuracy: 5 }, permissions: ['geolocation'] });

type Seg = { coords: [number, number][]; cls: number; push: boolean; rail: boolean };
type Rec = { id: string } & Record<string, unknown>;
const state = <T>(page: Page, fn: string) => page.evaluate(`(() => { const s = window.__liscio.getState(); return ${fn}; })()`) as Promise<T>;

async function routeTo(page: Page, query: string, pick: RegExp) {
  await page.getByRole('button', { name: /^Arrivée/ }).click();
  await page.getByRole('searchbox', { name: 'Rechercher une adresse' }).fill(query);
  await page.getByRole('list', { name: 'Résultats' }).getByRole('button', { name: pick }).first().click();
  await waitForState(page, "s.routeStatus === 'done'");
}

/** Taps a geographic point on the map after centring it. */
async function tapAt(page: Page, [lon, lat]: [number, number]) {
  await page.evaluate(
    ([x, y]) =>
      new Promise<void>((resolve) => {
        const m = (window as unknown as { __map: { jumpTo(o: object): void; once(e: string, cb: () => void): void } }).__map;
        m.once('idle', () => resolve());
        m.jumpTo({ center: [x, y], zoom: 17, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
      }),
    [lon, lat],
  );
  const box = (await page.locator('.map').boundingBox())!;
  const p = await page.evaluate(([x, y]) => (window as unknown as { __map: { project(c: [number, number]): { x: number; y: number } } }).__map.project([x, y]), [lon, lat] as [number, number]);
  await page.mouse.click(box.x + p.x, box.y + p.y);
}

test('marking a smooth street of the route as pavé changes the level-2 route; backup round-trip', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('liscio.downloadOnly', '1'));
  await firstLaunch(page);
  await waitForState(page, "s.engine === 'ready'");
  await routeTo(page, 'corso magenta', /Corso Magenta/);
  const before = await state<{ distance: number; segs: Seg[] }>(page, '(() => { const r = s.routes.find((x) => x.level === 2); return { distance: r.stats.distance, segs: r.segments }; })()');

  // Midpoint of the longest smooth, rail-free, ridden stretch of the level-2 route.
  const smooth = before.segs.filter((sg) => sg.cls === 0 && !sg.rail && !sg.push).sort((a, b) => b.coords.length - a.coords.length)[0]!;
  const mid = smooth.coords[Math.floor(smooth.coords.length / 2)]!;

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /^Corrections/ }).click();
  await tapAt(page, mid);
  const sheet = page.getByRole('region', { name: 'Tronçon' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('radiogroup', { name: 'Revêtement' }).getByRole('radio', { name: 'Lisse' })).toHaveAttribute('aria-checked', 'true');
  const whole = sheet.getByRole('switch', { name: /Appliquer à toute la rue/ });
  if (await whole.isEnabled()) {
    await whole.check();
    await waitForState(page, 's.street !== null');
  }
  await sheet.getByRole('radiogroup', { name: 'Revêtement' }).getByRole('radio', { name: 'Pavé' }).click();
  await expect(sheet).toContainText('(corrigé)');
  // "Rétablir OSM" removes them, then mark again.
  await sheet.getByRole('button', { name: 'Rétablir OSM' }).click();
  await expect(sheet).not.toContainText('(corrigé)');
  await waitForState(page, 's.corrections.length === 0');
  await sheet.getByRole('radiogroup', { name: 'Revêtement' }).getByRole('radio', { name: 'Pavé' }).click();
  await expect(sheet).toContainText('(corrigé)');
  const corrected = await state<number>(page, 's.corrections.length');
  expect(corrected).toBeGreaterThan(0);

  // Leaving the Corrections screen recomputes: the level-2 route is different.
  await page.getByRole('button', { name: 'Terminer' }).click();
  await waitForState(page, "s.mode === 'map' && s.routeStatus === 'done'");
  await expect
    .poll(() => state<string>(page, "JSON.stringify(s.routes.find((x) => x.level === 2).segments.map((g) => g.coords))"))
    .not.toBe(JSON.stringify(before.segs.map((g) => g.coords)));
  const after = await state<number>(page, 's.routes.find((x) => x.level === 2).stats.distance');
  expect(after).not.toBeCloseTo(before.distance, 0);

  // Export, delete everything, import: identical corrections.
  const original = await state<Rec[]>(page, '[...s.corrections].sort((a, b) => a.id.localeCompare(b.id))');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /^Corrections/ }).click();
  await page.getByRole('button', { name: /^Liste/ }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exporter la sauvegarde (JSON)' }).click()]);
  const file = await download.path();
  const backup = JSON.parse(readFileSync(file, 'utf8')) as { corrections: Rec[] };
  expect(backup.corrections).toHaveLength(original.length);

  while ((await state<number>(page, 's.corrections.length')) > 0) {
    await page.getByRole('list', { name: 'Corrections' }).getByRole('button', { name: /^Supprimer la correction/ }).first().click();
    await page.waitForTimeout(150);
  }
  await page.getByLabel('Fichier de sauvegarde').setInputFiles(file);
  await waitForState(page, `s.corrections.length === ${original.length}`);
  const restored = await state<Rec[]>(page, '[...s.corrections].sort((a, b) => a.id.localeCompare(b.id))');
  expect(restored).toEqual(original);

  // GeoJSON export for OSM.
  const [geo] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exporter pour OSM (GeoJSON)' }).click()]);
  const fc = JSON.parse(readFileSync(await geo.path(), 'utf8')) as { features: { properties: { osm_way: string; surface_osm_suggere: string } }[] };
  expect(fc.features).toHaveLength(original.length);
  expect(fc.features[0]!.properties.osm_way).toMatch(/^https:\/\/www\.openstreetmap\.org\/way\/\d+$/);
  expect(fc.features[0]!.properties.surface_osm_suggere).toBe('sett');
});

test('reports to sort open the Corrections screen on the spot; settings change the route', async ({ page }) => {
  await firstLaunch(page);
  // A report as the tracking "Signaler" button stores it, next to Via Torino.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('milano-liscio', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction('reports', 'readwrite');
          tx.objectStore('reports').put({ id: 'r1', lon: 9.1858, lat: 45.4608, heading: 200, accuracy: 6, at: Date.now(), status: 'todo' });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
  await page.reload();
  await waitForMap(page);
  await waitForState(page, "s.engine === 'ready'");
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('button', { name: /^Corrections/ })).toContainText('1 à trier');
  await page.getByRole('button', { name: /^Corrections/ }).click();
  await page.getByRole('button', { name: /^Liste/ }).click();
  await page.getByRole('tab', { name: /À trier/ }).click();
  await page.getByRole('list', { name: 'Signalements' }).getByRole('button', { name: /^Signalement du/ }).click();
  await expect(page.getByRole('region', { name: 'Tronçon' })).toBeVisible();
  await waitForState(page, "s.mode === 'corrections' && !!s.focusReport");
  await page.getByRole('button', { name: /^Liste/ }).click();
  await page.getByRole('tab', { name: /À trier/ }).click();
  await page.getByRole('button', { name: 'Trié' }).click();
  await waitForState(page, "s.reports.every((r) => r.status === 'done')");
  await page.getByRole('dialog', { name: 'Liste des corrections' }).getByRole('button', { name: 'Fermer' }).click();
  await page.getByRole('button', { name: 'Terminer' }).click();

  // Settings: faster average speed → shorter announced duration; no pushing → no metres on foot.
  await routeTo(page, 'piazza ventiquattro maggio', /Piazza Ventiquattro Maggio/);
  const dur = await state<number>(page, 's.routes.find((x) => x.level === s.selected).stats.duration');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.getByRole('slider', { name: 'Vitesse moyenne' }).fill('22');
  await page.getByRole('switch', { name: 'Autoriser les passages à pied' }).uncheck();
  await waitForState(page, 's.prefs.speed === 22 && s.prefs.allowPush === false');
  await expect.poll(() => state<number>(page, 's.routes.find((x) => x.level === s.selected).stats.duration')).toBeLessThan(dur);
  await expect.poll(() => state<number>(page, 'Math.max(...s.routes.map((x) => x.stats.pushM))')).toBe(0);
});
