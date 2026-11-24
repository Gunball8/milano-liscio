/**
 * Phase 0, step 1: downloads the raw OSM data for Milan into data/raw/ (SPEC §5.2).
 *
 *   pnpm data:fetch                     boundaries via Overpass, bulk data from the Geofabrik extract
 *   pnpm data:fetch --refresh           same, downloading a newer Geofabrik extract
 *   pnpm data:fetch --source=overpass   bulk data via Overpass too (3×3 tiles)
 *   pnpm data:fetch --force             ignore every cache
 *
 * Zone: bbox of the Comune di Milano boundary (wikidata Q490) plus a 1 km margin.
 * Bulk data default to Geofabrik because the public Overpass instances were saturated on 2026-11-24.
 * Overpass path: bboxes are set per statement, not globally (a global [bbox] clips `out geom` at tile edges).
 */
import { readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildFromExtract, downloadExtract } from './lib/geofabrik.ts';
import { RAW_DIR, fetchOverpass, sleep } from './lib/overpass.ts';
import { type Bbox, type OsmRelation, bboxOf, bboxToOverpass, readRaw, tileBbox } from './lib/osm.ts';

const force = process.argv.includes('--force');
const refresh = process.argv.includes('--refresh');
const source = process.argv.find((a) => a.startsWith('--source='))?.slice('--source='.length) ?? 'geofabrik';
if (source !== 'geofabrik' && source !== 'overpass') throw new Error(`unknown --source=${source}`);
const MARGIN_M = 1000;
const TILES = 3;
const PAUSE_MS = 3000;

async function step(name: string, query: string) {
  const didFetch = await fetchOverpass(name, query.trim() + '\n', { force });
  if (didFetch) await sleep(PAUSE_MS);
}

async function main() {
  console.log('Comune di Milano boundary');
  await step(
    'milano-boundary',
    `
[out:json][timeout:180];
rel["wikidata"="Q490"]["boundary"="administrative"];
out geom;`,
  );

  const boundary = (await readRaw('milano-boundary')).find((e): e is OsmRelation => e.type === 'relation');
  if (!boundary?.members) throw new Error('Milano boundary relation not found');
  const points = boundary.members.flatMap((m) => m.geometry ?? []);
  const bbox: Bbox = bboxOf(points, MARGIN_M);
  const bb = bboxToOverpass(bbox);
  await writeFile(path.join(RAW_DIR, '_bbox.json'), JSON.stringify({ marginMeters: MARGIN_M, ...bbox }, null, 2) + '\n');
  console.log(`  zone bbox (S,W,N,E) with ${MARGIN_M} m margin: ${bb}`);

  console.log('Sub-municipal boundaries (municipi)');
  await step(
    'milano-subareas',
    `
[out:json][timeout:180];
rel["boundary"="administrative"]["admin_level"~"^(9|10)$"](${bb});
out geom;`,
  );

  if (source === 'geofabrik') {
    console.log('Bulk data from the Geofabrik extract');
    await removeRaw(/^(highways|addresses)-r\d+c\d+\.(json|query\.txt)$/);
    await downloadExtract(refresh || force);
    await buildFromExtract(bbox);
    console.log('Done.');
    return;
  }
  await removeRaw(/^(highways|addresses)\.json$/);

  console.log('Tram rails');
  await step(
    'rails',
    `
[out:json][timeout:300];
(
  way["railway"~"^(tram|disused|construction)$"](${bb});
  way["disused:railway"="tram"](${bb});
);
out meta geom;`,
  );

  console.log('Point features (tram crossings, barriers)');
  await step(
    'nodes',
    `
[out:json][timeout:300];
(
  node["railway"~"^(tram_level_crossing|tram_crossing)$"](${bb});
  node["barrier"](${bb});
);
out meta;`,
  );

  console.log(`Highways (${TILES}×${TILES} tiles)`);
  for (const t of tileBbox(bbox, TILES, TILES)) {
    await step(
      `highways-r${t.r}c${t.c}`,
      `
[out:json][timeout:300][maxsize:1073741824];
way["highway"](${bboxToOverpass(t.bbox)});
out meta geom;`,
    );
  }

  console.log(`Addresses (${TILES}×${TILES} tiles)`);
  for (const t of tileBbox(bbox, TILES, TILES)) {
    await step(
      `addresses-r${t.r}c${t.c}`,
      `
[out:json][timeout:300][maxsize:1073741824];
node["addr:housenumber"](${bboxToOverpass(t.bbox)});
out body;
way["addr:housenumber"](${bboxToOverpass(t.bbox)});
out tags center;
rel["addr:housenumber"](${bboxToOverpass(t.bbox)});
out tags center;`,
    );
  }

  console.log('Done.');
}

/** Deletes raw files of the other source so the two never mix on read. */
async function removeRaw(pattern: RegExp) {
  for (const f of await readdir(RAW_DIR)) if (pattern.test(f)) await rm(`${RAW_DIR}/${f}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
