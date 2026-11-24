/**
 * Offline basemap (SPEC §5.4): extract of the latest Protomaps daily build for the Milan zone,
 * plus local glyphs and sprites so labels still render without network.
 *
 *   pnpm data:basemap            reuse what exists
 *   pnpm data:basemap --refresh  extract again from the newest build
 *
 * Requires the `pmtiles` CLI (brew install pmtiles).
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { RAW_DIR } from './lib/overpass.ts';

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(PUBLIC, 'data/milano.pmtiles');
const STATE = path.join(RAW_DIR, '_basemap.json');
const BUILDS_JSON = 'https://build-metadata.protomaps.dev/builds.json';
const BUILD_BASE = 'https://build.protomaps.com/';
const ASSETS_BASE = 'https://protomaps.github.io/basemaps-assets/';
const BUDGET_MB = 40;
/** Font stacks used by @protomaps/basemaps layers (Devanagari is only for lang "hi"). */
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
/**
 * Glyph ranges kept: Latin, IPA, Greek, Cyrillic (0–1279), Latin Extended Additional, Greek Extended,
 * General Punctuation, Letterlike Symbols (7680–8703). Other scripts are not needed for Milan;
 * CJK falls back to the device font (MapLibre localIdeographFontFamily).
 */
const GLYPH_RANGE_STARTS = [0, 256, 512, 768, 1024, 7680, 7936, 8192, 8448];
const SPRITE_FILES = ['light.json', 'light.png', 'light@2x.json', 'light@2x.png', 'dark.json', 'dark.png', 'dark@2x.json', 'dark@2x.png'];
const USER_AGENT = 'milano-liscio/0.1 (offline bike routing, build-time data fetch)';

const refresh = process.argv.includes('--refresh');

async function pmtiles(args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await run('pmtiles', args, { maxBuffer: 1 << 24 });
    return stdout + stderr;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') throw new Error('pmtiles not found: install it with "brew install pmtiles"');
    throw new Error(`pmtiles ${args[0]} failed: ${e.stderr ?? e.message}`);
  }
}

/** Newest build that is still online (builds are kept about a week, never hard-code a date). */
async function latestBuild(): Promise<string> {
  const res = await fetch(BUILDS_JSON, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`builds list: HTTP ${res.status}`);
  const builds = ((await res.json()) as { key: string }[]).map((b) => b.key).sort().reverse();
  for (const key of builds.slice(0, 10)) {
    const head = await fetch(BUILD_BASE + key, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } });
    if (head.ok) return key;
  }
  throw new Error('no recent Protomaps build is online');
}

async function extract(bbox: string) {
  const state = existsSync(STATE) ? (JSON.parse(await readFile(STATE, 'utf8')) as { build: string; maxzoom: number }) : null;
  if (!refresh && state && existsSync(OUT)) {
    console.log(`  basemap: cached (build ${state.build}, maxzoom ${state.maxzoom}), use --refresh for a newer one`);
    return;
  }
  const build = await latestBuild();
  const url = BUILD_BASE + build;
  let maxzoom = 15;
  const dry = await pmtiles(['extract', url, '/dev/null', `--bbox=${bbox}`, `--maxzoom=${maxzoom}`, '--dry-run']);
  const mb = Number(dry.match(/archive size of ([\d.]+) ?MB/)?.[1] ?? NaN);
  console.log(`  basemap: build ${build}, dry run at maxzoom 15 → ${mb} MB`);
  if (!(mb <= BUDGET_MB)) {
    maxzoom = 14; // vector tiles overzoom fine
    console.log(`  basemap: over ${BUDGET_MB} MB budget, using maxzoom 14`);
  }
  await mkdir(path.dirname(OUT), { recursive: true });
  const tmp = `${OUT}.part`;
  await pmtiles(['extract', url, tmp, `--bbox=${bbox}`, `--maxzoom=${maxzoom}`]);
  await rename(tmp, OUT);
  await writeFile(STATE, JSON.stringify({ build, maxzoom, extractedAt: new Date().toISOString() }, null, 2) + '\n');
  console.log(`  basemap: wrote public/data/milano.pmtiles (${((await stat(OUT)).size / 1e6).toFixed(1)} MB)`);
}

async function download(rel: string, dest: string): Promise<'ok' | 'cached' | 'missing'> {
  if (existsSync(dest)) return 'cached';
  const res = await fetch(ASSETS_BASE + rel.split('/').map(encodeURIComponent).join('/'), { headers: { 'User-Agent': USER_AGENT } });
  if (res.status === 404) return 'missing';
  if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, new Uint8Array(await res.arrayBuffer()));
  return 'ok';
}

async function assets() {
  const counts = { ok: 0, cached: 0, missing: 0 };
  for (const font of FONTS) {
    for (const start of GLYPH_RANGE_STARTS) {
      const rel = `fonts/${font}/${start}-${start + 255}.pbf`;
      counts[await download(rel, path.join(PUBLIC, rel))]++;
    }
  }
  for (const f of SPRITE_FILES) counts[await download(`sprites/v4/${f}`, path.join(PUBLIC, 'sprites/v4', f))]++;
  console.log(`  assets: ${counts.ok} downloaded, ${counts.cached} cached, ${counts.missing} not provided upstream`);
}

async function main() {
  const b = JSON.parse(await readFile(path.join(RAW_DIR, '_bbox.json'), 'utf8')) as Record<string, number>;
  const bbox = [b['west'], b['south'], b['east'], b['north']].map((v) => v!.toFixed(5)).join(',');
  console.log('Basemap');
  await extract(bbox);
  console.log('Fonts and sprites');
  await assets();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
