/**
 * On-device storage (SPEC §8): favourites, recent places, settings, and (phase 5) corrections and
 * reports. Nothing here ever leaves the phone.
 */
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

export interface Favorite {
  id: string;
  name: string;
  lon: number;
  lat: number;
  createdAt: number;
}

export interface Recent {
  id: string;
  label: string;
  sublabel: string;
  lon: number;
  lat: number;
  usedAt: number;
}

interface LiscioDB extends DBSchema {
  favorites: { key: string; value: Favorite };
  recents: { key: string; value: Recent };
  settings: { key: string; value: unknown };
  corrections: { key: string; value: { id: string } & Record<string, unknown> };
  reports: { key: string; value: { id: string } & Record<string, unknown> };
}

const MAX_RECENTS = 12;
let dbPromise: Promise<IDBPDatabase<LiscioDB>> | null = null;

function db() {
  dbPromise ??= openDB<LiscioDB>('milano-liscio', 1, {
    upgrade(d) {
      d.createObjectStore('favorites', { keyPath: 'id' });
      d.createObjectStore('recents', { keyPath: 'id' });
      d.createObjectStore('settings');
      d.createObjectStore('corrections', { keyPath: 'id' });
      d.createObjectStore('reports', { keyPath: 'id' });
    },
  });
  return dbPromise;
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export async function listFavorites(): Promise<Favorite[]> {
  return (await (await db()).getAll('favorites')).sort((a, b) => a.createdAt - b.createdAt);
}

export async function addFavorite(name: string, lon: number, lat: number): Promise<Favorite> {
  const f: Favorite = { id: newId(), name: name.trim() || 'Favori', lon, lat, createdAt: Date.now() };
  await (await db()).put('favorites', f);
  return f;
}

export async function removeFavorite(id: string): Promise<void> {
  await (await db()).delete('favorites', id);
}

export async function listRecents(): Promise<Recent[]> {
  return (await (await db()).getAll('recents')).sort((a, b) => b.usedAt - a.usedAt);
}

export async function pushRecent(r: Omit<Recent, 'id' | 'usedAt'>): Promise<void> {
  const d = await db();
  const id = `${r.label}|${r.lon.toFixed(5)}|${r.lat.toFixed(5)}`;
  await d.put('recents', { ...r, id, usedAt: Date.now() });
  const all = await listRecents();
  for (const old of all.slice(MAX_RECENTS)) await d.delete('recents', old.id);
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await (await db()).get('settings', key);
    return v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await db()).put('settings', value, key);
}
