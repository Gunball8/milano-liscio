/**
 * Phase 4 acceptance (SPEC §11, §12): tracking with simulated geolocation — progress, leaving the
 * route and recalculation, imprecise fixes, report button, arrival.
 */
import { type Page, expect, test } from '@playwright/test';
import { appState, firstLaunch, pointAlong, waitForState } from './helpers.ts';

const START = { latitude: 45.4641, longitude: 9.19, accuracy: 5 };
test.use({ geolocation: START, permissions: ['geolocation'] });

async function moveTo(page: Page, [lon, lat]: [number, number], accuracy = 5) {
  await page.context().setGeolocation({ longitude: lon, latitude: lat, accuracy });
  await waitForState(page, `!!s.position && Math.abs(s.position.lon - ${lon}) < 1e-7 && Math.abs(s.position.lat - ${lat}) < 1e-7`);
}

const followed = async (page: Page) => {
  const s = await appState(page);
  return s.routes!.find((r) => r.level === s.selected)!.segments.flatMap((seg) => seg.coords);
};

test('tracking: progress, off-route recalculation, imprecise GPS, report, arrival', async ({ page }, info) => {
  await firstLaunch(page);
  await waitForState(page, "s.engine === 'ready'");
  await page.getByRole('button', { name: /^Arrivée/ }).click();
  await page.getByRole('searchbox', { name: 'Rechercher une adresse' }).fill('corso magenta');
  await page.getByRole('list', { name: 'Résultats' }).getByRole('button', { name: /Corso Magenta/ }).first().click();
  await waitForState(page, "s.routeStatus === 'done'");

  await page.getByRole('button', { name: 'Démarrer' }).click();
  const banner = page.getByRole('region', { name: 'Suivi' });
  await expect(banner).toContainText('restants');
  await expect(banner).toContainText(/arrivée \d{2}:\d{2}/);

  // Progress along the route: remaining distance goes down, the map follows and turns with the course.
  const path = await followed(page);
  let last = (await appState(page)).tracking!.remainingM;
  for (const f of [0.1, 0.2, 0.3, 0.4]) {
    await moveTo(page, pointAlong(path, f));
    const t = (await appState(page)).tracking!;
    expect(t.remainingM).toBeLessThan(last);
    last = t.remainingM;
  }
  expect((await appState(page)).tracking!.recalcs).toBe(0);
  // The position arrow points along the course while riding (no compass in the test browser).
  const arrow = await page.evaluate(() => {
    const m = (window as unknown as { __map: { querySourceFeatures(s: string): { properties: { heading: number } }[] } }).__map;
    return m.querySourceFeatures('liscio-me')[0]?.properties.heading ?? null;
  });
  expect(arrow).not.toBeNull();
  expect(arrow!).toBeGreaterThanOrEqual(0);
  // Fixes 60+ m apart in about a second: well above 2 m/s, so the map turns with the course.
  const course = (await appState(page)).tracking!.bearing;
  expect(course).not.toBe(0);
  await expect
    .poll(async () => {
      const b = await page.evaluate(() => (window as unknown as { __map: { getBearing(): number } }).__map.getBearing());
      return Math.abs((((b - course) % 360) + 540) % 360 - 180);
    })
    .toBeLessThan(2);
  await page.screenshot({ path: info.outputPath('tracking.png') });

  // Leave the route: three precise fixes 120 m away trigger a recalculation from there.
  const [lon, lat] = pointAlong(path, 0.4);
  for (let i = 0; i < 3; i++) await moveTo(page, [lon + i * 0.00002, lat + 0.00108]);
  await waitForState(page, 's.tracking.recalcs === 1');

  // Imprecise fixes (±60 m) far away: flagged, never recalculated.
  for (let i = 0; i < 3; i++) await moveTo(page, [lon + 0.004 + i * 0.00002, lat - 0.003], 60);
  await expect(banner).toContainText('GPS imprécis');
  expect((await appState(page)).tracking!.recalcs).toBe(1);

  // Report button: position, heading, time stored on the device.
  await page.getByRole('button', { name: /^Signaler/ }).click();
  await waitForState(page, 's.tracking.reports === 1');

  // Arrival within 25 m of the destination ends the session.
  const end = (await followed(page)).at(-1)!;
  await moveTo(page, [end[0] + 0.00005, end[1]]);
  await expect(page.getByRole('dialog', { name: 'Arrivée' })).toContainText('1 signalement');
  await page.getByRole('dialog', { name: 'Arrivée' }).getByRole('button', { name: 'Terminer' }).click();
  // Arrived: the trip is over, the map is ready for the next one.
  await waitForState(page, "s.mode === 'map' && s.tracking === null && s.to === null");
});
