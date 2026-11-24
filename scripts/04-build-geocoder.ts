/**
 * Phase 3: builds public/data/milano-geocoder.bin (SPEC §6.4): streets with a representative point on
 * the street and their house numbers (phase 0 decision 3), plus named places (stations, metro,
 * universities, squares, museums, parks, hospitals, churches, city gates).
 *
 *   pnpm data:geocoder
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Tags } from '../src/core/classify.ts';
import { MILAN_PROJECTION as P } from '../src/core/geo.ts';
import { type GeoEntryInput, KIND_PLACE, KIND_STREET, serializeGeocoder } from '../src/core/geocode.ts';
import { normalizeName, numberVariants, searchKey, stripStreetType } from '../src/core/text.ts';
import { type OsmElement, type OsmRelation, type OsmWay, readRaw, readTiles } from './lib/osm.ts';
import { readFetchLog } from './lib/overpass.ts';
import { type Perimeter, assembleRings, polygonPerimeter } from './lib/polygon.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public/data/milano-geocoder.bin');
const NOT_STREETS = new Set(['proposed', 'construction', 'platform', 'bus_stop', 'elevator', 'corridor', 'steps', 'raceway']);
const CLUSTER_GAP_M = 150;
const NUMBER_MAX_M = 600;

const xy = (lon: number, lat: number) => [P.x(lon), P.y(lat)] as const;

/** Every search key of a name: with and without street type, apostrophes merged, day numbers in 3 forms. */
function keysOf(names: string[]): string[] {
  const out = new Set<string>();
  for (const name of names) {
    const base = [searchKey(name), searchKey(name.replace(/['’`]/g, ''))];
    for (const k of base) {
      if (!k) continue;
      const stripped = stripStreetType(k);
      for (const v of [k, ...(stripped ? [stripped] : [])]) {
        out.add(v);
        for (const n of numberVariants(v)) out.add(n);
      }
    }
  }
  return [...out];
}

function wayLength(w: OsmWay): number {
  const g = w.geometry!;
  let l = 0;
  for (let i = 1; i < g.length; i++) l += Math.hypot(P.x(g[i]!.lon) - P.x(g[i - 1]!.lon), P.y(g[i]!.lat) - P.y(g[i - 1]!.lat));
  return l;
}

function wayMidpoint(w: OsmWay): [number, number] {
  const g = w.geometry!;
  const half = wayLength(w) / 2;
  let acc = 0;
  for (let i = 1; i < g.length; i++) {
    const l = Math.hypot(P.x(g[i]!.lon) - P.x(g[i - 1]!.lon), P.y(g[i]!.lat) - P.y(g[i - 1]!.lat));
    if (acc + l >= half) {
      const f = l === 0 ? 0 : (half - acc) / l;
      return [g[i - 1]!.lon + f * (g[i]!.lon - g[i - 1]!.lon), g[i - 1]!.lat + f * (g[i]!.lat - g[i - 1]!.lat)];
    }
    acc += l;
  }
  return [g[0]!.lon, g[0]!.lat];
}

interface Cluster {
  name: string;
  ways: OsmWay[];
  length: number;
  /** projected bbox */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  numbers: Map<string, { n: string; lon: number; lat: number; v: number }>;
}

function boxGap(c: Cluster, x: number, y: number): number {
  const dx = Math.max(c.minX - x, 0, x - c.maxX);
  const dy = Math.max(c.minY - y, 0, y - c.maxY);
  return Math.hypot(dx, dy);
}

function buildClusters(ways: OsmWay[]): Map<string, Cluster[]> {
  const byName = new Map<string, OsmWay[]>();
  for (const w of ways) {
    const k = normalizeName(w.tags!['name']!);
    const list = byName.get(k);
    if (list) list.push(w);
    else byName.set(k, [w]);
  }
  const out = new Map<string, Cluster[]>();
  for (const [key, list] of byName) {
    const clusters: Cluster[] = [];
    for (const w of list) {
      const c: Cluster = { name: w.tags!['name']!, ways: [w], length: wayLength(w), minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, numbers: new Map() };
      for (const g of w.geometry!) {
        const [x, y] = xy(g.lon, g.lat);
        c.minX = Math.min(c.minX, x);
        c.maxX = Math.max(c.maxX, x);
        c.minY = Math.min(c.minY, y);
        c.maxY = Math.max(c.maxY, y);
      }
      clusters.push(c);
    }
    // merge clusters whose boxes are closer than CLUSTER_GAP_M until stable
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const a = clusters[i]!;
          const b = clusters[j]!;
          const gx = Math.max(a.minX - b.maxX, 0, b.minX - a.maxX);
          const gy = Math.max(a.minY - b.maxY, 0, b.minY - a.maxY);
          if (Math.hypot(gx, gy) > CLUSTER_GAP_M) continue;
          a.ways.push(...b.ways);
          a.length += b.length;
          a.minX = Math.min(a.minX, b.minX);
          a.minY = Math.min(a.minY, b.minY);
          a.maxX = Math.max(a.maxX, b.maxX);
          a.maxY = Math.max(a.maxY, b.maxY);
          clusters.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
    out.set(key, clusters);
  }
  return out;
}

const POI_KINDS: { test: (t: Tags) => boolean; label: string; weight: number }[] = [
  { test: (t) => t['railway'] === 'station' && t['station'] === 'subway', label: 'Métro', weight: 2 },
  { test: (t) => t['railway'] === 'station', label: 'Gare', weight: 2.5 },
  { test: (t) => /^(university|college)$/.test(t['amenity'] ?? ''), label: 'Université', weight: 1.8 },
  { test: (t) => t['amenity'] === 'hospital', label: 'Hôpital', weight: 1.8 },
  { test: (t) => t['tourism'] === 'museum', label: 'Musée', weight: 1.6 },
  { test: (t) => t['leisure'] === 'park', label: 'Parc', weight: 1.5 },
  { test: (t) => t['place'] === 'square', label: 'Place', weight: 1.5 },
  { test: (t) => t['historic'] === 'city_gate', label: 'Porte', weight: 1.4 },
  { test: (t) => t['amenity'] === 'place_of_worship', label: 'Lieu de culte', weight: 1 },
  { test: (t) => t['public_transport'] === 'station', label: 'Station', weight: 0.8 },
];

async function main() {
  const t0 = Date.now();
  const boundary = (await readRaw('milano-boundary')).find((e): e is OsmRelation => e.type === 'relation')!;
  const commune = polygonPerimeter('Milano', assembleRings(boundary));
  const municipi: Perimeter[] = (await readRaw('milano-subareas'))
    .filter((e): e is OsmRelation => e.type === 'relation' && /^Municipio \d+$/.test(e.tags?.['name'] ?? ''))
    .map((r) => polygonPerimeter(r.tags!['name']!, assembleRings(r)));
  const area = (lon: number, lat: number) => {
    if (!commune.contains(lon, lat)) return { inside: false, sub: 'hors Milan' };
    return { inside: true, sub: municipi.find((m) => m.contains(lon, lat))?.label ?? 'Milano' };
  };

  // ---- streets
  const ways = (await readTiles('highways')).filter(
    (e): e is OsmWay =>
      e.type === 'way' &&
      !!e.geometry &&
      e.geometry.length > 1 &&
      !!e.tags?.['name'] &&
      !NOT_STREETS.has(e.tags['highway'] ?? '') &&
      !/^(sidewalk|crossing)$/.test(e.tags['footway'] ?? ''),
  );
  const clusters = buildClusters(ways);

  // ---- house numbers → nearest cluster of the same name
  let attached = 0;
  let unmatched = 0;
  for (const e of (await readTiles('addresses')) as OsmElement[]) {
    const t = e.tags ?? {};
    const street = t['addr:street'];
    const num = t['addr:housenumber'];
    const c = e.type === 'node' ? e : e.center;
    if (!street || !num || !c) continue;
    const list = clusters.get(normalizeName(street));
    if (!list) {
      unmatched++;
      continue;
    }
    const [x, y] = xy(c.lon, c.lat);
    let best: Cluster | null = null;
    let bestGap = NUMBER_MAX_M;
    for (const cl of list) {
      const gap = boxGap(cl, x, y);
      if (gap < bestGap) {
        bestGap = gap;
        best = cl;
      }
    }
    if (!best) {
      unmatched++;
      continue;
    }
    for (const n of num.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
      const k = n.toLowerCase().replace(/\s/g, '');
      if (!best.numbers.has(k)) {
        best.numbers.set(k, { n, lon: c.lon, lat: c.lat, v: Number.parseInt(n, 10) });
        attached++;
      }
    }
  }

  const entries: GeoEntryInput[] = [];
  for (const list of clusters.values()) {
    for (const cl of list) {
      const longest = cl.ways.reduce((a, b) => (wayLength(b) > wayLength(a) ? b : a));
      const [lon, lat] = wayMidpoint(longest);
      const { inside, sub } = area(lon, lat);
      const names = [cl.name, ...cl.ways.flatMap((w) => [w.tags!['alt_name'], w.tags!['official_name']]).filter((v): v is string => !!v)];
      entries.push({
        kind: KIND_STREET,
        name: cl.name,
        sub,
        lon,
        lat,
        weight: (inside ? 1 : 0) + Math.min(1.5, Math.log10(1 + cl.length / 100)),
        keys: keysOf(names),
        numbers: [...cl.numbers.values()].sort((a, b) => (a.v || 0) - (b.v || 0) || a.n.localeCompare(b.n)).map(({ n, lon: x, lat: y }) => ({ n, lon: x, lat: y })),
      });
    }
  }
  const streetCount = entries.length;

  // ---- named places, deduplicated (same name and kind within 300 m)
  const seen: { key: string; x: number; y: number }[] = [];
  for (const e of (await readRaw('pois')) as OsmElement[]) {
    const t = e.tags ?? {};
    const c = e.type === 'node' ? e : e.center;
    if (!t['name'] || !c) continue;
    const kind = POI_KINDS.find((k) => k.test(t));
    if (!kind) continue;
    const [x, y] = xy(c.lon, c.lat);
    const dedupeKey = `${kind.label}|${normalizeName(t['name'])}`;
    if (seen.some((s) => s.key === dedupeKey && Math.hypot(s.x - x, s.y - y) < 300)) continue;
    seen.push({ key: dedupeKey, x, y });
    const names = ['name', 'alt_name', 'official_name', 'short_name', 'name:it']
      .flatMap((k) => (t[k] ?? '').split(';'))
      .map((s) => s.trim())
      .filter(Boolean);
    const aliases: string[] = [];
    if (kind.label === 'Gare') {
      for (const n of names) {
        const m = n.match(/^Milano\s+(.+)$/i);
        if (m) aliases.push(`Stazione ${m[1]}`, `Stazione di ${n}`, m[1]!);
      }
    }
    if (kind.label === 'Métro') aliases.push(...names.map((n) => `Metro ${n}`));
    const { inside, sub } = area(c.lon, c.lat);
    entries.push({
      kind: KIND_PLACE,
      name: t['name'],
      sub: `${kind.label} · ${sub}`,
      lon: c.lon,
      lat: c.lat,
      weight: kind.weight + (inside ? 1 : 0),
      keys: keysOf([...names, ...aliases]),
      numbers: [],
    });
  }

  const osmBase = (await readFetchLog()).filter((e) => e.name === 'highways').at(-1)?.osmBase ?? null;
  const bin = serializeGeocoder(entries, { builtAt: new Date().toISOString(), osmBase });
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, bin);
  console.log(`streets ${streetCount}, places ${entries.length - streetCount}, house numbers ${attached} (${unmatched} without a matching street)`);
  console.log(`wrote public/data/milano-geocoder.bin: ${(bin.byteLength / 1e6).toFixed(2)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
