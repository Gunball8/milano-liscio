import { MILAN_PROJECTION as P } from '../../src/core/geo.ts';
import type { OsmWay } from './osm.ts';

export interface Edge {
  /** Index into the way array passed to splitIntoEdges. */
  wayIdx: number;
  /** OSM node ids at both ends (build-time only). */
  startNode: number;
  endNode: number;
  /** Position of the first and last vertex in the way's node list. */
  startPos: number;
  endPos: number;
  /** Projected coordinates in meters, interleaved x0,y0,x1,y1,... */
  xy: Float64Array;
  /** Geographic coordinates, interleaved lon0,lat0,lon1,lat1,... */
  ll: Float64Array;
  length: number;
}

/**
 * Splits ways at every node shared by two or more of them (SPEC §6.4): graph nodes are way ends
 * and shared nodes. Consecutive pieces are never merged across ways, so an edge has one tag set.
 */
export function splitIntoEdges(ways: OsmWay[]): Edge[] {
  const usage = new Map<number, number>();
  for (const w of ways) for (const n of w.nodes) usage.set(n, (usage.get(n) ?? 0) + 1);

  const edges: Edge[] = [];
  ways.forEach((w, wayIdx) => {
    const g = w.geometry;
    if (!g || g.length !== w.nodes.length || g.length < 2) return;
    let start = 0;
    for (let i = 1; i < g.length; i++) {
      if (i < g.length - 1 && (usage.get(w.nodes[i]!) ?? 0) < 2) continue;
      const n = i - start + 1;
      const xy = new Float64Array(n * 2);
      const ll = new Float64Array(n * 2);
      let length = 0;
      for (let k = 0; k < n; k++) {
        const p = g[start + k]!;
        ll[2 * k] = p.lon;
        ll[2 * k + 1] = p.lat;
        xy[2 * k] = P.x(p.lon);
        xy[2 * k + 1] = P.y(p.lat);
        if (k > 0) length += Math.hypot(xy[2 * k]! - xy[2 * k - 2]!, xy[2 * k + 1]! - xy[2 * k - 1]!);
      }
      edges.push({ wayIdx, startNode: w.nodes[start]!, endNode: w.nodes[i]!, startPos: start, endPos: i, xy, ll, length });
      start = i;
    }
  });
  return edges;
}
