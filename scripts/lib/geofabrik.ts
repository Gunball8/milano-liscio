/**
 * Bulk OSM data from a Geofabrik extract, cut to the Milan zone with osmium-tool.
 * Used because Overpass was saturated on 2026-11-24 (see docs/audit.md). Produces the same
 * Overpass-shaped JSON files as the Overpass path, so downstream scripts don't care about the source.
 *
 * Requires `osmium` (brew install osmium-tool).
 */
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { appendFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { Tags } from '../../src/core/classify.ts';
import type { Bbox, LatLon, OsmNode, OsmRelation, OsmWay } from './osm.ts';
import { FETCH_LOG, type FetchLogEntry, RAW_DIR } from './overpass.ts';

const run = promisify(execFile);

export const EXTRACT_URL = 'https://download.geofabrik.de/europe/italy/nord-ovest-latest.osm.pbf';
const PBF_DIR = path.join(RAW_DIR, 'pbf');
const PBF = path.join(PBF_DIR, 'nord-ovest-latest.osm.pbf');
const USER_AGENT = 'milano-liscio/0.1 (offline bike routing, build-time data fetch)';

async function osmium(args: string[]): Promise<string> {
  try {
    const { stdout } = await run('osmium', args, { maxBuffer: 1 << 24 });
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') throw new Error('osmium not found: install it with "brew install osmium-tool"');
    throw new Error(`osmium ${args[0]} failed: ${e.stderr ?? e.message}`);
  }
}

/** Downloads the regional extract unless already present (refresh forces a new download). */
export async function downloadExtract(refresh: boolean): Promise<void> {
  await mkdir(PBF_DIR, { recursive: true });
  if (existsSync(PBF) && !refresh) {
    console.log(`  extract: cached (${path.relative(RAW_DIR, PBF)}), use --refresh to download a newer one`);
    return;
  }
  console.log(`  extract: downloading ${EXTRACT_URL}`);
  const res = await fetch(EXTRACT_URL, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`extract download failed: HTTP ${res.status}`);
  const tmp = `${PBF}.part`;
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(tmp));
  await rename(tmp, PBF);
  console.log(`  extract: saved (${res.url.split('/').pop()})`);
}

export async function extractTimestamp(): Promise<string> {
  return (await osmium(['fileinfo', '-g', 'header.option.osmosis_replication_timestamp', PBF])).trim();
}

/** OPL escapes: %<hex code point>% */
const unescapeOpl = (s: string) => s.replace(/%([0-9a-fA-F]+)%/g, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)));

function parseTags(field: string): Tags | undefined {
  if (field.length === 0) return undefined;
  const tags: Tags = {};
  for (const kv of field.split(',')) {
    const i = kv.indexOf('=');
    tags[unescapeOpl(kv.slice(0, i))] = unescapeOpl(kv.slice(i + 1));
  }
  return tags;
}

interface Buckets {
  highways: OsmWay[];
  rails: OsmWay[];
  nodes: OsmNode[];
  addresses: (OsmNode | OsmWay)[];
  pois: (OsmNode | OsmWay | OsmRelation)[];
}

/** Named places for the geocoder (SPEC §6.4): stations, universities, squares, museums, parks, hospitals, churches. */
const POI_FILTERS = [
  'nwr/railway=station',
  'nwr/public_transport=station',
  'nwr/amenity=university,college,hospital,place_of_worship',
  'nwr/tourism=museum',
  'nwr/leisure=park',
  'nwr/place=square',
  'nwr/historic=city_gate',
];
function isPoi(t: Tags): boolean {
  if (!t['name']) return false;
  return (
    t['railway'] === 'station' ||
    t['public_transport'] === 'station' ||
    /^(university|college|hospital|place_of_worship)$/.test(t['amenity'] ?? '') ||
    t['tourism'] === 'museum' ||
    t['leisure'] === 'park' ||
    t['place'] === 'square' ||
    t['historic'] === 'city_gate'
  );
}

const RAIL_RE = /^(tram|disused|construction)$/;
const CROSSING_RE = /^(tram_level_crossing|tram_crossing)$/;

/**
 * Cuts the Milan zone out of the regional extract, keeps the tags the project needs and
 * writes highways.json, rails.json, nodes.json, addresses.json into data/raw/.
 */
export async function buildFromExtract(bbox: Bbox): Promise<void> {
  const osmBase = await extractTimestamp();
  console.log(`  extract: OSM data as of ${osmBase}`);
  const work = path.join(PBF_DIR, 'work');
  await mkdir(work, { recursive: true });
  const cut = path.join(work, 'milano.osm.pbf');
  const filtered = path.join(work, 'milano-filtered.osm.pbf');
  const opl = path.join(work, 'milano.opl');

  const b = [bbox.west, bbox.south, bbox.east, bbox.north].map((v) => v.toFixed(5)).join(',');
  console.log(`  osmium extract -b ${b} (complete ways)`);
  await osmium(['extract', '-b', b, '--strategy', 'complete_ways', '--overwrite', '-o', cut, PBF]);
  console.log('  osmium tags-filter');
  await osmium([
    'tags-filter', '--overwrite', '-o', filtered, cut,
    'w/highway',
    'w/railway=tram,disused,construction',
    'w/disused:railway=tram',
    'n/railway=tram_level_crossing,tram_crossing',
    'n/barrier',
    'nw/addr:housenumber',
    ...POI_FILTERS,
  ]);
  console.log('  osmium add-locations-to-ways (OPL)');
  await osmium(['add-locations-to-ways', '--overwrite', '-f', 'opl', '-o', opl, filtered]);

  const buckets: Buckets = { highways: [], rails: [], nodes: [], addresses: [], pois: [] };
  // Centres of every way (tagged or not), to place relation POIs (multipolygons) at their outer ways.
  const wayCentre = new Map<number, [number, number, number]>();
  const poiRelations: { id: number; timestamp?: string; tags: Tags; ways: number[] }[] = [];
  const rl = createInterface({ input: createReadStream(opl), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length === 0) continue;
    const fields = line.split(' ');
    const kind = fields[0]![0];
    const id = Number(fields[0]!.slice(1));
    let timestamp: string | undefined;
    let version: number | undefined;
    let tags: Tags | undefined;
    let lon = NaN;
    let lat = NaN;
    let nodeField = '';
    let memberField = '';
    for (const f of fields.slice(1)) {
      const k = f[0];
      const v = f.slice(1);
      if (k === 't') timestamp = v || undefined;
      else if (k === 'v') version = Number(v);
      else if (k === 'T') tags = parseTags(v);
      else if (k === 'x') lon = Number(v);
      else if (k === 'y') lat = Number(v);
      else if (k === 'N') nodeField = v;
      else if (k === 'M') memberField = v;
    }
    if (kind === 'w' && nodeField) {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const ref of nodeField.split(',')) {
        const xi = ref.indexOf('x');
        const yi = ref.indexOf('y');
        if (xi < 0 || yi < 0) continue;
        sx += Number(ref.slice(xi + 1, yi));
        sy += Number(ref.slice(yi + 1));
        n++;
      }
      if (n > 0) wayCentre.set(id, [sx, sy, n]);
    }
    if (!tags) continue;
    if (kind === 'r') {
      if (isPoi(tags) && memberField) {
        const ways = memberField
          .split(',')
          .filter((m) => m.startsWith('w') && (m.endsWith('@outer') || m.endsWith('@')))
          .map((m) => Number(m.slice(1, m.indexOf('@'))));
        poiRelations.push({ id, timestamp, tags, ways });
      }
      continue;
    }

    if (kind === 'n') {
      const node: OsmNode = { type: 'node', id, lat, lon, timestamp, tags };
      if (CROSSING_RE.test(tags['railway'] ?? '') || tags['barrier']) buckets.nodes.push(node);
      if (tags['addr:housenumber']) buckets.addresses.push(node);
      if (isPoi(tags)) buckets.pois.push(node);
    } else if (kind === 'w') {
      const nodes: number[] = [];
      const geometry: LatLon[] = [];
      let complete = true;
      for (const ref of nodeField.split(',')) {
        const xi = ref.indexOf('x');
        const yi = ref.indexOf('y');
        if (xi < 0 || yi < 0) {
          complete = false;
          break;
        }
        nodes.push(Number(ref.slice(1, xi)));
        geometry.push({ lon: Number(ref.slice(xi + 1, yi)), lat: Number(ref.slice(yi + 1)) });
      }
      if (!complete || nodes.length === 0) continue;
      const way: OsmWay = { type: 'way', id, timestamp, version, nodes, geometry, tags };
      if (tags['highway']) buckets.highways.push(way);
      if (RAIL_RE.test(tags['railway'] ?? '') || tags['disused:railway'] === 'tram') buckets.rails.push(way);
      const center = {
        lat: geometry.reduce((s, g) => s + g.lat, 0) / geometry.length,
        lon: geometry.reduce((s, g) => s + g.lon, 0) / geometry.length,
      };
      if (tags['addr:housenumber']) buckets.addresses.push({ type: 'way', id, timestamp, nodes: [], center, tags });
      if (isPoi(tags)) buckets.pois.push({ type: 'way', id, timestamp, nodes: [], center, tags });
    }
  }

  for (const r of poiRelations) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const w of r.ways) {
      const c = wayCentre.get(w);
      if (!c) continue;
      sx += c[0];
      sy += c[1];
      n += c[2];
    }
    if (n > 0) buckets.pois.push({ type: 'relation', id: r.id, timestamp: r.timestamp, center: { lon: sx / n, lat: sy / n }, tags: r.tags });
  }

  const source = `download.geofabrik.de (${path.basename(EXTRACT_URL)})`;
  for (const [name, elements] of Object.entries(buckets)) {
    const text = JSON.stringify({ osm3s: { timestamp_osm_base: osmBase, source }, elements });
    await writeFile(path.join(RAW_DIR, `${name}.json`), text);
    await rm(path.join(RAW_DIR, `${name}.query.txt`), { force: true });
    const entry: FetchLogEntry = { name, endpoint: source, fetchedAt: new Date().toISOString(), osmBase, elements: elements.length, bytes: text.length };
    await appendFile(FETCH_LOG, JSON.stringify(entry) + '\n');
    console.log(`  ${name}: ${elements.length} elements, ${(text.length / 1e6).toFixed(1)} MB`);
  }
  await rm(work, { recursive: true, force: true });
}

