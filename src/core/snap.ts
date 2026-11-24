/**
 * Snapping a position to the nearest rideable edge (SPEC §7): spatial grid over edge segments,
 * projection on the closest segment within maxDist meters, else null ("hors réseau").
 */
import type { EdgePoint } from './astar.ts';
import { MILAN_PROJECTION as P, pointSegmentDistance } from './geo.ts';
import { COORD_SCALE, FLAG_PUSH, type Graph, arcEdgeIndex } from './graph.ts';

export const SNAP_MAX_M = 100;

export interface Snapped extends EdgePoint {
  /** Distance from the query point to the network, meters. */
  dist: number;
}

export class SnapIndex {
  /** Full polylines of rideable edges (endpoints included), projected meters. */
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  /** Points of edge e: ptStart[e] .. ptStart[e+1]-1 (empty range for non-rideable edges). */
  private readonly ptStart: Uint32Array;
  /** Edge owning the segment that starts at point i (-1 for the last point of an edge). */
  private readonly segEdge: Int32Array;
  private readonly cells = new Map<number, number[]>();

  constructor(
    private readonly g: Graph,
    private readonly cellMeters = 64,
  ) {
    const E = g.header.edgeCount;
    const rideable = new Uint8Array(E);
    for (let a = 0; a < g.header.arcCount; a++) if ((g.arcFlags[a]! & FLAG_PUSH) === 0) rideable[arcEdgeIndex(g, a)] = 1;
    this.ptStart = new Uint32Array(E + 1);
    let n = 0;
    for (let e = 0; e < E; e++) {
      this.ptStart[e] = n;
      if (rideable[e]) n += g.edgeCoordStart[e + 1]! - g.edgeCoordStart[e]! + 2;
    }
    this.ptStart[E] = n;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.segEdge = new Int32Array(n).fill(-1);
    const nodeXY = (node: number, i: number) => {
      this.x[i] = P.x(g.nodeLon[node]! / COORD_SCALE);
      this.y[i] = P.y(g.nodeLat[node]! / COORD_SCALE);
    };
    for (let e = 0; e < E; e++) {
      const s = this.ptStart[e]!;
      const end = this.ptStart[e + 1]!;
      if (s === end) continue;
      nodeXY(g.edgeFrom[e]!, s);
      let i = s + 1;
      for (let c = g.edgeCoordStart[e]!; c < g.edgeCoordStart[e + 1]!; c++, i++) {
        this.x[i] = P.x(g.coordLon[c]! / COORD_SCALE);
        this.y[i] = P.y(g.coordLat[c]! / COORD_SCALE);
      }
      nodeXY(g.edgeTo[e]!, end - 1);
      for (let k = s; k < end - 1; k++) {
        this.segEdge[k] = e;
        const c0 = Math.floor(Math.min(this.x[k]!, this.x[k + 1]!) / cellMeters);
        const c1 = Math.floor(Math.max(this.x[k]!, this.x[k + 1]!) / cellMeters);
        const r0 = Math.floor(Math.min(this.y[k]!, this.y[k + 1]!) / cellMeters);
        const r1 = Math.floor(Math.max(this.y[k]!, this.y[k + 1]!) / cellMeters);
        for (let cx = c0; cx <= c1; cx++) {
          for (let r = r0; r <= r1; r++) {
            const key = cx * 100_000 + r;
            let list = this.cells.get(key);
            if (!list) this.cells.set(key, (list = []));
            list.push(k);
          }
        }
      }
    }
  }

  nearest(lon: number, lat: number, maxDist = SNAP_MAX_M): Snapped | null {
    const px = P.x(lon);
    const py = P.y(lat);
    const reach = Math.ceil(maxDist / this.cellMeters);
    const cx = Math.floor(px / this.cellMeters);
    const cy = Math.floor(py / this.cellMeters);
    let best = maxDist;
    let bestSeg = -1;
    const seen = new Set<number>();
    for (let c = cx - reach; c <= cx + reach; c++) {
      for (let r = cy - reach; r <= cy + reach; r++) {
        const list = this.cells.get(c * 100_000 + r);
        if (!list) continue;
        for (const i of list) {
          if (seen.has(i)) continue;
          seen.add(i);
          const d = pointSegmentDistance(px, py, this.x[i]!, this.y[i]!, this.x[i + 1]!, this.y[i + 1]!);
          if (d <= best) {
            best = d;
            bestSeg = i;
          }
        }
      }
    }
    if (bestSeg < 0) return null;
    const e = this.segEdge[bestSeg]!;
    // fraction along the edge
    let total = 0;
    let before = 0;
    let along = 0;
    let qx = 0;
    let qy = 0;
    for (let i = this.ptStart[e]!; i < this.ptStart[e + 1]! - 1; i++) {
      const dx = this.x[i + 1]! - this.x[i]!;
      const dy = this.y[i + 1]! - this.y[i]!;
      const l = Math.hypot(dx, dy);
      if (i === bestSeg) {
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - this.x[i]!) * dx + (py - this.y[i]!) * dy) / len2));
        before = total;
        along = t * l;
        qx = this.x[i]! + t * dx;
        qy = this.y[i]! + t * dy;
      }
      total += l;
    }
    return { edge: e, t: total === 0 ? 0 : (before + along) / total, lon: P.lon(qx), lat: P.lat(qy), dist: best };
  }
}
