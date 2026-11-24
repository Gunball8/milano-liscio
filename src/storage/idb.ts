/**
 * On-device storage (SPEC §8): favourites, recent places, settings, and (phase 5) corrections and
 * reports. Nothing here ever leaves the phone.
 */
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { CorrectionRecord } from '../core/corrections.ts';

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

/** "Signaler" button while riding (SPEC §9.2): position, heading and time, to sort later. */
export interface Report {
  id: string;
  lon: number;
  lat: number;
  heading: number | null;
  accuracy: number | null;
  at: number;
  status: 'todo' | 'done';
}

interface LiscioDB extends DBSchema {
  favorites: { key: string; value: Favorite };
  recents: { key: string; value: Recent };
  settings: { key: string; value: unknown };
  corrections: { key: string; value: CorrectionRecord };
  reports: { key: string; value: Report };
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

export async function addReport(r: Omit<Report, 'id' | 'status'>): Promise<Report> {
  const report: Report = { ...r, id: newId(), status: 'todo' };
  await (await db()).put('reports', report);
  return report;
}

export async function listReports(): Promise<Report[]> {
  return (await (await db()).getAll('reports')).sort((a, b) => b.at - a.at);
}

export async function updateReport(r: Report): Promise<void> {
  await (await db()).put('reports', r);
}

export async function deleteReport(id: string): Promise<void> {
  await (await db()).delete('reports', id);
}

export async function listCorrections(): Promise<CorrectionRecord[]> {
  return (await (await db()).getAll('corrections')).sort((a, b) => b.createdAt - a.createdAt);
}

export async function putCorrections(list: CorrectionRecord[]): Promise<void> {
  const tx = (await db()).transaction('corrections', 'readwrite');
  await Promise.all([...list.map((c) => tx.store.put(c)), tx.done]);
}

export async function deleteCorrections(ids: string[]): Promise<void> {
  const tx = (await db()).transaction('corrections', 'readwrite');
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

export async function putFavorites(list: Favorite[]): Promise<void> {
  const tx = (await db()).transaction('favorites', 'readwrite');
  await Promise.all([...list.map((f) => tx.store.put(f)), tx.done]);
}

export async function putReports(list: Report[]): Promise<void> {
  const tx = (await db()).transaction('reports', 'readwrite');
  await Promise.all([...list.map((r) => tx.store.put(r)), tx.done]);
}

export { newId };
