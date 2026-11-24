/**
 * Turns a search result into what the UI shows (SPEC §7, last bullet): polyline, per-segment class,
 * distance, duration, meters of PAVE / SLABS / along rails / on foot, shallow crossings.
 */
import type { PathPiece, SearchResult } from './astar.ts';
import { type Corrections, effectiveArc } from './cost.ts';
import { MILAN_PROJECTION as P } from './geo.ts';
import { COORD_SCALE, type Graph, arcEdgeIndex, arcReversed } from './graph.ts';

export type LngLat = [number, number];

export interface RouteSegment {
  coords: LngLat[];
  /** Surface code (SMOOTH 0, SLABS 1, PAVE 2, LOOSE 3, UNKNOWN 4). */
  cls: number;
  push: boolean;
  rail: boolean;
  length: number;
}

export interface RouteStats {
  cost: number;
  distance: number;
  /** Seconds. */
  duration: number;
  paveM: number;
  slabsM: number;
  railM: number;
  pushM: number;
  crossings: number;
}

export interface Route {
  polyline: LngLat[];
  segments: RouteSegment[];
  stats: RouteStats;
  /** Arcs used, for tests and diagnostics. */
  pieces: PathPiece[];
}

export interface Speeds {
  /** km/h */
  ride: number;
  push: number;
}

export const DEFAULT_SPEEDS: Speeds = { ride: 15, push: 4.5 };

/** Geometry of an arc between two fractions of its length, in travel direction. */
export function arcSubline(g: Graph, arc: number, t0: number, t1: number): LngLat[] {
  const e = arcEdgeIndex(g, arc);
  const start = g.edgeCoordStart[e]!;
  const end = g.edgeCoordStart[e + 1]!;
  const pts: LngLat[] = [];
  for (let i = start; i < end; i++) pts.push([g.coordLon[i]! / COORD_SCALE, g.coordLat[i]! / COORD_SCALE]);
  if (arcReversed(g, arc)) pts.reverse();
  if (t0 <= 0 && t1 >= 1) return pts;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1]!, pts[i]!];
    cum.push(cum[i - 1]! + Math.hypot(P.x(b[0]) - P.x(a[0]), P.y(b[1]) - P.y(a[1])));
  }
  const total = cum[cum.length - 1]!;
  const at = (s: number): LngLat => {
    const d = s * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i]! < d) i++;
    const seg = cum[i]! - cum[i - 1]!;
    const f = seg === 0 ? 0 : (d - cum[i - 1]!) / seg;
    const [a, b] = [pts[i - 1]!, pts[i]!];
    return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
  };
  const out: LngLat[] = [at(t0)];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i]! > t0 * total && cum[i]! < t1 * total) out.push(pts[i]!);
  out.push(at(t1));
  return out;
}

export function assembleRoute(g: Graph, result: SearchResult, corrections?: Corrections, speeds: Speeds = DEFAULT_SPEEDS): Route {
  const stats: RouteStats = { cost: result.cost, distance: 0, duration: 0, paveM: 0, slabsM: 0, railM: 0, pushM: 0, crossings: 0 };
  const segments: RouteSegment[] = [];
  const polyline: LngLat[] = [];
  let crossings = 0;
  for (const p of result.pieces) {
    const { cls, rail, length, push } = effectiveArc(g, p.arc, corrections);
    const f = Math.max(0, p.t1 - p.t0);
    const len = length * f;
    stats.distance += len;
    stats.duration += (len / 1000 / (push ? speeds.push : speeds.ride)) * 3600;
    if (cls === 2) stats.paveM += len;
    if (cls === 1) stats.slabsM += len;
    if (push) stats.pushM += len;
    stats.railM += rail * f;
    crossings += g.arcCross[p.arc]! * f;
    const coords = arcSubline(g, p.arc, p.t0, p.t1);
    const last = segments[segments.length - 1];
    const isRail = rail > 0;
    if (last && last.cls === cls && last.push === push && last.rail === isRail) {
      last.coords.push(...coords.slice(1));
      last.length += len;
    } else {
      segments.push({ coords, cls, push, rail: isRail, length: len });
    }
    if (polyline.length === 0) polyline.push(...coords);
    else polyline.push(...coords.slice(1));
  }
  stats.crossings = Math.round(crossings);
  return { polyline, segments, stats, pieces: result.pieces };
}

/** Geographic point at fraction t of an edge (forward geometry). */
export function pointOnEdge(g: Graph, edge: number, t: number): { lon: number; lat: number } {
  const start = g.edgeCoordStart[edge]!;
  const end = g.edgeCoordStart[edge + 1]!;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = start; i < end; i++) {
    xs.push(P.x(g.coordLon[i]! / COORD_SCALE));
    ys.push(P.y(g.coordLat[i]! / COORD_SCALE));
  }
  let total = 0;
  for (let i = 1; i < xs.length; i++) total += Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!);
  let d = t * total;
  for (let i = 1; i < xs.length; i++) {
    const l = Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!);
    if (d <= l || i === xs.length - 1) {
      const f = l === 0 ? 0 : Math.min(1, d / l);
      return { lon: P.lon(xs[i - 1]! + f * (xs[i]! - xs[i - 1]!)), lat: P.lat(ys[i - 1]! + f * (ys[i]! - ys[i - 1]!)) };
    }
    d -= l;
  }
  return { lon: g.coordLon[start]! / COORD_SCALE, lat: g.coordLat[start]! / COORD_SCALE };
}
