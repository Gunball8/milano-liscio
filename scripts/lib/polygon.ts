import { MILAN_PROJECTION as P } from '../../src/core/geo.ts';
import type { OsmRelation } from './osm.ts';

export type Ring = [number, number][]; // [lon, lat]

/** Joins the outer/inner member ways of a boundary relation into closed rings. */
export function assembleRings(rel: OsmRelation): Ring[] {
  const pieces: Ring[] = (rel.members ?? [])
    .filter((m) => m.type === 'way' && m.geometry && m.geometry.length > 1 && (m.role === 'outer' || m.role === 'inner' || m.role === ''))
    .map((m) => m.geometry!.map((g) => [g.lon, g.lat] as [number, number]));
  const key = (p: [number, number]) => `${p[0]},${p[1]}`;
  const rings: Ring[] = [];
  while (pieces.length > 0) {
    const ring: Ring = [...pieces.pop()!];
    let closed = key(ring[0]!) === key(ring[ring.length - 1]!);
    while (!closed) {
      const end = key(ring[ring.length - 1]!);
      const i = pieces.findIndex((p) => key(p[0]!) === end || key(p[p.length - 1]!) === end);
      if (i < 0) break; // open ring: closed implicitly by the point-in-polygon test
      const next = pieces.splice(i, 1)[0]!;
      if (key(next[0]!) !== end) next.reverse();
      ring.push(...next.slice(1));
      closed = key(ring[0]!) === key(ring[ring.length - 1]!);
    }
    rings.push(ring);
  }
  return rings;
}

/** Even-odd point-in-polygon over several rings (holes handled by parity). */
function inRings(rings: Float64Array[], x: number, y: number): boolean {
  let inside = false;
  for (const r of rings) {
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[2 * i]!;
      const yi = r[2 * i + 1]!;
      const xj = r[2 * j]!;
      const yj = r[2 * j + 1]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export interface Perimeter {
  label: string;
  contains(lon: number, lat: number): boolean;
  /** GeoJSON geometry for the audit map. */
  geometry: { type: 'Polygon'; coordinates: Ring[] };
}

/**
 * Polygon membership with a result cache on a regular grid (cell centre is tested).
 * Error is bounded by half a cell diagonal near the boundary, which is fine for length statistics.
 */
export function polygonPerimeter(label: string, rings: Ring[], cellMeters = 25): Perimeter {
  const projected = rings.map((r) => {
    const a = new Float64Array(r.length * 2);
    r.forEach(([lon, lat], i) => {
      a[2 * i] = P.x(lon);
      a[2 * i + 1] = P.y(lat);
    });
    return a;
  });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const a of projected) {
    for (let i = 0; i < a.length; i += 2) {
      minX = Math.min(minX, a[i]!);
      maxX = Math.max(maxX, a[i]!);
      minY = Math.min(minY, a[i + 1]!);
      maxY = Math.max(maxY, a[i + 1]!);
    }
  }
  const cache = new Map<number, boolean>();
  return {
    label,
    geometry: { type: 'Polygon', coordinates: rings },
    contains(lon, lat) {
      const x = P.x(lon);
      const y = P.y(lat);
      if (x < minX || x > maxX || y < minY || y > maxY) return false;
      const cx = Math.floor(x / cellMeters);
      const cy = Math.floor(y / cellMeters);
      const k = cx * 100_000 + cy;
      let v = cache.get(k);
      if (v === undefined) {
        v = inRings(projected, (cx + 0.5) * cellMeters, (cy + 0.5) * cellMeters);
        cache.set(k, v);
      }
      return v;
    },
  };
}

export function circlePerimeter(label: string, lon: number, lat: number, radiusMeters: number): Perimeter {
  const cx = P.x(lon);
  const cy = P.y(lat);
  const ring: Ring = [];
  for (let i = 0; i <= 64; i++) {
    const a = (2 * Math.PI * i) / 64;
    ring.push([P.lon(cx + radiusMeters * Math.cos(a)), P.lat(cy + radiusMeters * Math.sin(a))]);
  }
  return {
    label,
    geometry: { type: 'Polygon', coordinates: [ring] },
    contains(lo, la) {
      const dx = P.x(lo) - cx;
      const dy = P.y(la) - cy;
      return dx * dx + dy * dy <= radiusMeters * radiusMeters;
    },
  };
}
