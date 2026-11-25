/**
 * Data manifest read by the app (SPEC §8): version, OSM date, zone, and size + SHA-256 of every
 * data file, so the phone can verify a download before switching to it.
 *
 *   pnpm data:manifest
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { RAW_DIR, readFetchLog } from './lib/overpass.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'public/data');
/** Files the app downloads, in order. */
const FILES = ['milano-graph.bin', 'milano.pmtiles', 'milano-geocoder.bin', 'milano-ways.bin'];

const sha256 = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });

async function main() {
  const files = [];
  for (const name of FILES) {
    const p = path.join(DATA, name);
    if (!existsSync(p)) {
      console.log(`  ${name}: absent, skipped`);
      continue;
    }
    // transfer: bytes over the wire, the host compresses these files (gzip) on the fly
    files.push({ name, size: (await stat(p)).size, transfer: gzipSync(await readFile(p), { level: 6 }).length, sha256: await sha256(p) });
  }
  if (files.length === 0) throw new Error('no data file in public/data, run the data scripts first');
  const osmBase = (await readFetchLog()).filter((e) => e.name === 'highways').at(-1)?.osmBase ?? null;
  const basemap = existsSync(path.join(RAW_DIR, '_basemap.json')) ? (JSON.parse(await readFile(path.join(RAW_DIR, '_basemap.json'), 'utf8')) as { build: string }) : null;
  const zone = JSON.parse(await readFile(path.join(RAW_DIR, '_bbox.json'), 'utf8')) as Record<string, number>;
  const digest = createHash('sha256').update(files.map((f) => f.sha256).join('')).digest('hex').slice(0, 8);
  const version = `${(osmBase ?? new Date().toISOString()).slice(0, 10).replaceAll('-', '')}-${digest}`;
  const manifest = {
    version,
    osmBase,
    basemapBuild: basemap?.build ?? null,
    builtAt: new Date().toISOString(),
    bbox: [zone['west'], zone['south'], zone['east'], zone['north']],
    files,
  };
  await writeFile(path.join(DATA, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const mb = files.reduce((s, f) => s + f.size, 0) / 1e6;
  const wire = files.reduce((s, f) => s + f.transfer, 0) / 1e6;
  console.log(`manifest ${version}: ${files.map((f) => f.name).join(', ')} (${mb.toFixed(1)} MB on the phone, ~${wire.toFixed(1)} MB to download)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
