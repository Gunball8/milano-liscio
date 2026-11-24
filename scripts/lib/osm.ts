import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Tags } from '../../src/core/classify.ts';
import { RAW_DIR } from './overpass.ts';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  timestamp?: string;
  tags?: Tags;
}

export interface OsmWay {
  type: 'way';
  id: number;
  timestamp?: string;
  version?: number;
  nodes: number[];
  geometry?: LatLon[];
  center?: LatLon;
  tags?: Tags;
}

export interface OsmMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role: string;
  geometry?: LatLon[];
}

export interface OsmRelation {
  type: 'relation';
  id: number;
  timestamp?: string;
  center?: LatLon;
  members?: OsmMember[];
  tags?: Tags;
}

export type OsmElement = OsmNode | OsmWay | OsmRelation;

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Overpass bbox syntax: south,west,north,east. */
export const bboxToOverpass = (b: Bbox) =>
  [b.south, b.west, b.north, b.east].map((v) => v.toFixed(5)).join(',');

/** Reads data/raw/<name>.json. */
export async function readRaw(name: string): Promise<OsmElement[]> {
  const text = await readFile(path.join(RAW_DIR, `${name}.json`), 'utf8');
  return (JSON.parse(text) as { elements: OsmElement[] }).elements;
}

/** Reads every data/raw/<prefix>*.json tile and removes duplicates (ways crossing tile edges come back once per tile). */
export async function readTiles(prefix: string): Promise<OsmElement[]> {
  const files = (await readdir(RAW_DIR)).filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`no raw files for "${prefix}" in ${RAW_DIR}, run "pnpm data:fetch" first`);
  const seen = new Map<string, OsmElement>();
  for (const f of files) {
    const elements = await readRaw(f.slice(0, -'.json'.length));
    for (const e of elements) {
      const key = `${e.type}/${e.id}`;
      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, e);
        continue;
      }
      // Defensive: if a tile returned a way with clipped geometry (null entries), fill it from another copy.
      if (prev.type === 'way' && e.type === 'way' && prev.geometry && e.geometry) {
        prev.geometry = prev.geometry.map((g, i) => g ?? e.geometry![i]!);
      }
    }
  }
  const out = [...seen.values()];
  const clipped = out.filter((e) => e.type === 'way' && e.geometry?.some((g) => g === null)).length;
  if (clipped > 0) console.warn(`${prefix}: ${clipped} ways still have clipped geometry`);
  return out;
}

/** Bbox of a set of coordinates, expanded by `marginMeters` on every side. */
export function bboxOf(points: Iterable<LatLon>, marginMeters = 0): Bbox {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const p of points) {
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
    if (p.lon < west) west = p.lon;
    if (p.lon > east) east = p.lon;
  }
  const dLat = marginMeters / 111_195;
  const dLon = marginMeters / (111_195 * Math.cos((((south + north) / 2) * Math.PI) / 180));
  return { south: south - dLat, west: west - dLon, north: north + dLat, east: east + dLon };
}

/** Splits a bbox into rows × cols tiles, returned with row/col indices. */
export function tileBbox(b: Bbox, rows: number, cols: number): { r: number; c: number; bbox: Bbox }[] {
  const tiles: { r: number; c: number; bbox: Bbox }[] = [];
  const dLat = (b.north - b.south) / rows;
  const dLon = (b.east - b.west) / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push({
        r,
        c,
        bbox: {
          south: b.south + r * dLat,
          north: b.south + (r + 1) * dLat,
          west: b.west + c * dLon,
          east: b.west + (c + 1) * dLon,
        },
      });
    }
  }
  return tiles;
}
