import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RAW_DIR = path.resolve(import.meta.dirname, '../../data/raw');
export const FETCH_LOG = path.join(RAW_DIR, '_fetch-log.jsonl');

/**
 * Tried in order, then round-robin. The VK mirror was the only responsive one on 2026-11-24.
 * overpass.private.coffee was dropped: it served data frozen at 2026-05-31 that day (see the freshness check).
 */
const ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const USER_AGENT = 'milano-liscio/0.1 (offline bike routing, build-time data fetch)';
const REQUEST_TIMEOUT_MS = 420_000;
const BASE_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 240_000;
/** Responses whose OSM data is older than this are rejected (stale mirrors). */
const MAX_DATA_AGE_DAYS = 7;

export interface FetchLogEntry {
  name: string;
  endpoint: string;
  fetchedAt: string;
  osmBase: string | null;
  elements: number;
  bytes: number;
}

export interface OverpassOptions {
  force?: boolean;
  maxAttempts?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs an Overpass query and caches the raw JSON in data/raw/<name>.json.
 * Idempotent: a cached file is reused unless the query text changed or `force` is set.
 * Returns true when a network request was made.
 */
export async function fetchOverpass(name: string, query: string, opts: OverpassOptions = {}): Promise<boolean> {
  await mkdir(RAW_DIR, { recursive: true });
  const file = path.join(RAW_DIR, `${name}.json`);
  const queryFile = path.join(RAW_DIR, `${name}.query.txt`);
  if (!opts.force && existsSync(file) && existsSync(queryFile)) {
    const cachedQuery = await readFile(queryFile, 'utf8');
    if (cachedQuery === query) {
      console.log(`  ${name}: cached`);
      return false;
    }
    console.log(`  ${name}: query changed, refetching`);
  }

  const maxAttempts = opts.maxAttempts ?? 20;
  let lastError = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length]!;
    const host = new URL(endpoint).host;
    const t0 = Date.now();
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trimStart().startsWith('{')) throw new Error(`non-JSON body: ${text.slice(0, 80).replace(/\s+/g, ' ')}`);
      const json = JSON.parse(text) as { remark?: string; elements?: unknown[]; osm3s?: { timestamp_osm_base?: string } };
      // Overpass reports timeouts and memory errors inside a 200 response.
      if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error(`remark: ${json.remark}`);
      if (!Array.isArray(json.elements)) throw new Error('no elements array');
      const base = json.osm3s?.timestamp_osm_base;
      const ageDays = base ? (Date.now() - Date.parse(base)) / 86_400_000 : Infinity;
      if (!(ageDays <= MAX_DATA_AGE_DAYS)) throw new Error(`stale data (OSM base ${base ?? 'unknown'})`);

      const tmp = `${file}.tmp`;
      await writeFile(tmp, text);
      await rename(tmp, file);
      await writeFile(queryFile, query);
      const entry: FetchLogEntry = {
        name,
        endpoint: host,
        fetchedAt: new Date().toISOString(),
        osmBase: json.osm3s?.timestamp_osm_base ?? null,
        elements: json.elements.length,
        bytes: text.length,
      };
      await appendFile(FETCH_LOG, JSON.stringify(entry) + '\n');
      const mb = (text.length / 1e6).toFixed(1);
      console.log(`  ${name}: ${json.elements.length} elements, ${mb} MB from ${host} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      return true;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const wait = Math.min(BASE_BACKOFF_MS * 2 ** Math.floor(attempt / ENDPOINTS.length), MAX_BACKOFF_MS);
      console.warn(`  ${name}: attempt ${attempt + 1}/${maxAttempts} on ${host} failed (${lastError}), retrying in ${wait / 1000} s`);
      await sleep(wait);
    }
  }
  throw new Error(`${name}: giving up after ${maxAttempts} attempts (last error: ${lastError})`);
}

export async function readFetchLog(): Promise<FetchLogEntry[]> {
  if (!existsSync(FETCH_LOG)) return [];
  const text = await readFile(FETCH_LOG, 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as FetchLogEntry);
}

export { sleep };
