/**
 * Minimal place lookup over the project's own OSM data (named POIs and streets), used to geocode the
 * reference pairs of SPEC §12 without hard-coded coordinates. The full offline geocoder is phase 3.
 */
import type { Tags } from '../../src/core/classify.ts';
import { MILAN_PROJECTION as P } from '../../src/core/geo.ts';
import { normalizeName } from '../../src/core/text.ts';
import { type OsmNode, type OsmWay, readRaw, readTiles } from './osm.ts';

export interface Place {
  name: string;
  kind: string;
  lon: number;
  lat: number;
  osm: string;
}

const NAME_KEYS = ['name', 'alt_name', 'official_name', 'short_name'];

function kindOf(t: Tags): string {
  if (t['railway'] === 'station') return t['station'] === 'subway' ? 'metro' : 'gare';
  if (t['public_transport'] === 'station') return 'station';
  return t['amenity'] ?? t['tourism'] ?? t['leisure'] ?? t['place'] ?? t['historic'] ?? 'lieu';
}

/** Point at half the length of a way. */
function wayMidpoint(w: OsmWay): [number, number] {
  const g = w.geometry!;
  const cum = [0];
  for (let i = 1; i < g.length; i++) cum.push(cum[i - 1]! + Math.hypot(P.x(g[i]!.lon) - P.x(g[i - 1]!.lon), P.y(g[i]!.lat) - P.y(g[i - 1]!.lat)));
  const half = cum[cum.length - 1]! / 2;
  let i = 1;
  while (i < cum.length - 1 && cum[i]! < half) i++;
  const f = cum[i]! === cum[i - 1]! ? 0 : (half - cum[i - 1]!) / (cum[i]! - cum[i - 1]!);
  return [g[i - 1]!.lon + f * (g[i]!.lon - g[i - 1]!.lon), g[i - 1]!.lat + f * (g[i]!.lat - g[i - 1]!.lat)];
}

export class PlaceIndex {
  private readonly byName = new Map<string, Place[]>();

  static async load(): Promise<PlaceIndex> {
    const idx = new PlaceIndex();
    for (const e of (await readRaw('pois')) as (OsmNode | OsmWay)[]) {
      const c = e.type === 'node' ? e : e.center;
      if (!c || !e.tags) continue;
      for (const k of NAME_KEYS) {
        for (const n of (e.tags[k] ?? '').split(';').filter(Boolean)) {
          idx.add({ name: n, kind: kindOf(e.tags), lon: c.lon, lat: c.lat, osm: `${e.type}/${e.id}` });
        }
      }
    }
    // streets: the longest way of each name stands for the street
    const longest = new Map<string, { w: OsmWay; len: number }>();
    for (const e of await readTiles('highways')) {
      if (e.type !== 'way' || !e.geometry || !e.tags?.['name']) continue;
      const g = e.geometry;
      let len = 0;
      for (let i = 1; i < g.length; i++) len += Math.hypot(P.x(g[i]!.lon) - P.x(g[i - 1]!.lon), P.y(g[i]!.lat) - P.y(g[i - 1]!.lat));
      const key = `${normalizeName(e.tags['name'])}|${Math.round(P.x(g[0]!.lon) / 3000)}|${Math.round(P.y(g[0]!.lat) / 3000)}`;
      const cur = longest.get(key);
      if (!cur || len > cur.len) longest.set(key, { w: e, len });
    }
    for (const { w } of longest.values()) {
      const [lon, lat] = wayMidpoint(w);
      idx.add({ name: w.tags!['name']!, kind: 'rue', lon, lat, osm: `way/${w.id}` });
    }
    return idx;
  }

  private add(p: Place) {
    const k = normalizeName(p.name);
    const list = this.byName.get(k);
    if (list) list.push(p);
    else this.byName.set(k, [p]);
  }

  /** Exact (normalized) name match; POIs before streets, then the one closest to the Duomo. */
  resolve(query: string): Place | undefined {
    const list = this.byName.get(normalizeName(query));
    if (!list) return undefined;
    const rank = (p: Place) => (p.kind === 'gare' ? 0 : p.kind === 'rue' ? 2 : 1);
    return [...list].sort((a, b) => rank(a) - rank(b) || Math.hypot(P.x(a.lon), P.y(a.lat)) - Math.hypot(P.x(b.lon), P.y(b.lat)))[0];
  }
}
