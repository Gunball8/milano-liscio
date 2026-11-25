/**
 * Offline data (SPEC §8): the app downloads the files listed in data/manifest.json itself, with
 * progress, checks size and SHA-256, and stores them in a cache named data-<version>. A version is
 * usable only once a completion marker is written; older caches are deleted after that.
 */

export interface DataFile {
  name: string;
  size: number;
  /** Approximate bytes over the wire (gzip by the host); older manifests lack it. */
  transfer?: number;
  sha256: string;
}

export interface DataManifest {
  version: string;
  osmBase: string | null;
  basemapBuild: string | null;
  builtAt: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  files: DataFile[];
}

export interface Progress {
  loaded: number;
  total: number;
  file: string;
}

const CACHE_PREFIX = 'data-';
const BASE = import.meta.env.BASE_URL;

/** Data URLs carry the version so caches and HTTP never mix two versions of a file. */
export const dataUrl = (name: string, version: string) => `${BASE}data/${encodeURIComponent(name)}?v=${encodeURIComponent(version)}`;
const completeUrl = `${BASE}data/__complete__`;
const cacheName = (version: string) => CACHE_PREFIX + version;

export const totalSize = (m: DataManifest) => m.files.reduce((s, f) => s + f.size, 0);
export const transferSize = (m: DataManifest) => m.files.reduce((s, f) => s + (f.transfer ?? f.size), 0);

/** Latest manifest from the network, or null when offline / unreachable. */
export async function fetchRemoteManifest(): Promise<DataManifest | null> {
  try {
    const res = await fetch(`${BASE}data/manifest.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as DataManifest;
  } catch {
    return null;
  }
}

/** Newest fully installed version (its manifest is stored with the completion marker). */
export async function installedManifest(): Promise<DataManifest | null> {
  if (!('caches' in globalThis)) return null;
  let best: DataManifest | null = null;
  for (const name of await caches.keys()) {
    if (!name.startsWith(CACHE_PREFIX)) continue;
    const marker = await (await caches.open(name)).match(completeUrl);
    if (!marker) continue;
    const m = (await marker.json()) as DataManifest;
    if (!best || m.builtAt > best.builtAt) best = m;
  }
  return best;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Downloads every file of a version into its cache. Files already stored (interrupted earlier
 * download) are kept. Throws on network error or checksum mismatch; the previous version stays usable.
 */
export async function downloadVersion(m: DataManifest, onProgress: (p: Progress) => void, signal?: AbortSignal): Promise<void> {
  const cache = await caches.open(cacheName(m.version));
  const total = totalSize(m);
  let done = 0;
  for (const f of m.files) {
    const url = dataUrl(f.name, m.version);
    if (await cache.match(url)) {
      done += f.size;
      onProgress({ loaded: done, total, file: f.name });
      continue;
    }
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok || !res.body) throw new Error(`${f.name} : HTTP ${res.status}`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      chunks.push(value);
      got += value.byteLength;
      onProgress({ loaded: done + got, total, file: f.name });
    }
    const blob = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
    if (blob.size !== f.size) throw new Error(`${f.name} : taille ${blob.size} au lieu de ${f.size}`);
    if ((await sha256Hex(await blob.arrayBuffer())) !== f.sha256) throw new Error(`${f.name} : empreinte SHA-256 incorrecte`);
    await cache.put(url, new Response(blob, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(f.size) } }));
    done += f.size;
  }
  await cache.put(completeUrl, new Response(JSON.stringify(m), { headers: { 'Content-Type': 'application/json' } }));
}

/**
 * Drops every data version but `keep` (SPEC §8: the old one goes only once the new one is in use).
 * Called once the map has loaded on `keep`: deleting earlier could pull the basemap file from under a
 * map still reading it (WebKit backs cached blobs with files).
 */
export async function deleteOtherVersions(keep: string): Promise<void> {
  for (const name of await caches.keys()) {
    if (name.startsWith(CACHE_PREFIX) && name !== cacheName(keep)) await caches.delete(name);
  }
}

export async function readDataFile(version: string, name: string): Promise<Blob> {
  const hit = await (await caches.open(cacheName(version))).match(dataUrl(name, version));
  if (!hit) throw new Error(`${name} absent du cache ${version}`);
  return hit.blob();
}

/** Asks the browser not to evict our storage (SPEC §4.3). null when the API is missing. */
export async function requestPersistence(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

export async function storageStatus(): Promise<{ persisted: boolean | null; usage: number | null; quota: number | null }> {
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => null) : null;
  const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  return { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
}
