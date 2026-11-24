import { type Page, expect } from '@playwright/test';

export interface MapProbe {
  features: number;
  labels: number;
}

/** First launch in a plain browser tab: skip the install hint, download the data, wait for the map. */
export async function firstLaunch(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continuer dans le navigateur' }).click();
  await page.getByRole('button', { name: /^Télécharger/ }).click();
  await expect(page.getByRole('button', { name: /^Données/ })).toBeVisible({ timeout: 180_000 });
  await waitForMap(page);
}

export async function waitForMap(page: Page) {
  await page.waitForFunction(() => {
    const m = (window as unknown as { __map?: { loaded(): boolean } }).__map;
    return !!m && m.loaded();
  }, null, { timeout: 60_000 });
}

/** Moves the map and counts rendered basemap features and labels once tiles are drawn. */
export async function probe(page: Page, lon: number, lat: number, zoom = 14): Promise<MapProbe> {
  return page.evaluate(
    async ([lo, la, z]) => {
      type Feature = { layer: { type: string } };
      const m = (window as unknown as {
        __map: { jumpTo(o: object): void; once(ev: string, cb: () => void): void; queryRenderedFeatures(): Feature[] };
      }).__map;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 20_000);
        m.once('idle', () => {
          clearTimeout(timer);
          resolve();
        });
        m.jumpTo({ center: [lo, la], zoom: z });
      });
      const f = m.queryRenderedFeatures();
      return { features: f.length, labels: f.filter((x) => x.layer.type === 'symbol').length };
    },
    [lon, lat, zoom] as const,
  );
}

/** Centre and four inner corners of the zone (15 % inset). */
export async function zonePoints(page: Page): Promise<[string, number, number][]> {
  const bbox = await page.evaluate(
    () => (window as unknown as { __liscio: { getState(): { installed: { bbox: number[] } } } }).__liscio.getState().installed.bbox,
  );
  const [w, s, e, n] = bbox as [number, number, number, number];
  const ix = (e - w) * 0.15;
  const iy = (n - s) * 0.15;
  return [
    ['Duomo', 9.1919, 45.4641],
    ['nord-ouest', w + ix, n - iy],
    ['nord-est', e - ix, n - iy],
    ['sud-ouest', w + ix, s + iy],
    ['sud-est', e - ix, s + iy],
  ];
}
