/**
 * Snapping a position to the nearest rideable edge (SPEC §7): uniform grid over edge segments stored as
 * CSR typed arrays (built in two passes, no per-cell arrays), projection on the closest segment within
 * maxDist meters, else null ("hors réseau").
 */
import type { EdgePoint } from './astar.ts';
import { MILAN_PROJECTION as P, pointSegmentDistance } from './geo.ts';
import { COORD_SCALE, FLAG_PUSH, type Graph } from './graph.ts';

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
  private readonly minX: number;
  private readonly minY: number;
  private readonly cols: number;
  private readonly rows: number;
  /** Segments of cell c: cellSeg[cellStart[c] .. cellStart[c+1]-1]. */
  private readonly cellStart: Uint32Array;
  private readonly cellSeg: Uint32Array;
  /** Per-segment stamp to skip segments already tested in this query. */
  private readonly seen: Uint32Array;
  private stamp = 0;

  constructor(
    g: Graph,
    private readonly cellMeters = 64,
  ) {
    const E = g.header.edgeCount;
    const rideable = new Uint8Array(E);
    for (let a = 0; a < g.header.arcCount; a++) {
      if ((g.arcFlags[a]! & FLAG_PUSH) !== 0) continue;
      const ev = g.arcEdge[a]!;
      rideable[ev >= 0 ? ev : ~ev] = 1;
    }
    this.ptStart = new Uint32Array(E + 1);
    let n = 0;
    for (let e = 0; e < E; e++) {
      this.ptStart[e] = n;
      if (rideable[e]) n += g.edgeCoordStart[e + 1]! - g.edgeCoordStart[e]! + 2;
    }
    this.ptStart[E] = n;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    const segEdge = new Int32Array(n).fill(-1);
    const kx = P.kx / COORD_SCALE;
    const ky = P.ky / COORD_SCALE;
    const ox = P.lon0 * COORD_SCALE;
    const oy = P.lat0 * COORD_SCALE;
    for (let e = 0; e < E; e++) {
      const s = this.ptStart[e]!;
      const end = this.ptStart[e + 1]!;
      if (s === end) continue;
      const from = g.edgeFrom[e]!;
      const to = g.edgeTo[e]!;
      x[s] = (g.nodeLon[from]! - ox) * kx;
      y[s] = (g.nodeLat[from]! - oy) * ky;
      let i = s + 1;
      for (let c = g.edgeCoordStart[e]!; c < g.edgeCoordStart[e + 1]!; c++, i++) {
        x[i] = (g.coordLon[c]! - ox) * kx;
        y[i] = (g.coordLat[c]! - oy) * ky;
      }
      x[end - 1] = (g.nodeLon[to]! - ox) * kx;
      y[end - 1] = (g.nodeLat[to]! - oy) * ky;
      for (let k = s; k < end - 1; k++) segEdge[k] = e;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const px = x[i]!;
      const py = y[i]!;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    if (n === 0) minX = minY = maxX = maxY = 0;
    const cm = cellMeters;
    const cols = Math.floor((maxX - minX) / cm) + 1;
    const rows = Math.floor((maxY - minY) / cm) + 1;
    const cells = cols * rows;

    // two passes over segments: count per cell, then fill (CSR)
    const start = new Uint32Array(cells + 1);
    for (let k = 0; k < n - 1; k++) {
      if (segEdge[k]! < 0) continue;
      const ax = x[k]!;
      const bx = x[k + 1]!;
      const ay = y[k]!;
      const by = y[k + 1]!;
      const c0 = Math.floor(((ax < bx ? ax : bx) - minX) / cm);
      const c1 = Math.floor(((ax < bx ? bx : ax) - minX) / cm);
      const r0 = Math.floor(((ay < by ? ay : by) - minY) / cm);
      const r1 = Math.floor(((ay < by ? by : ay) - minY) / cm);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) start[r * cols + c + 1]!++;
    }
    for (let c = 0; c < cells; c++) start[c + 1]! += start[c]!;
    const list = new Uint32Array(start[cells]!);
    const fill = start.slice(0, cells);
    for (let k = 0; k < n - 1; k++) {
      if (segEdge[k]! < 0) continue;
      const ax = x[k]!;
      const bx = x[k + 1]!;
      const ay = y[k]!;
      const by = y[k + 1]!;
      const c0 = Math.floor(((ax < bx ? ax : bx) - minX) / cm);
      const c1 = Math.floor(((ax < bx ? bx : ax) - minX) / cm);
      const r0 = Math.floor(((ay < by ? ay : by) - minY) / cm);
      const r1 = Math.floor(((ay < by ? by : ay) - minY) / cm);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) list[fill[r * cols + c]!++] = k;
    }
    this.x = x;
    this.y = y;
    this.segEdge = segEdge;
    this.minX = minX;
    this.minY = minY;
    this.cols = cols;
    this.rows = rows;
    this.cellStart = start;
    this.cellSeg = list;
    this.seen = new Uint32Array(n);
  }

  nearest(lon: number, lat: number, maxDist = SNAP_MAX_M): Snapped | null {
    const px = P.x(lon);
    const py = P.y(lat);
    const c0 = Math.max(0, Math.floor((px - maxDist - this.minX) / this.cellMeters));
    const c1 = Math.min(this.cols - 1, Math.floor((px + maxDist - this.minX) / this.cellMeters));
    const r0 = Math.max(0, Math.floor((py - maxDist - this.minY) / this.cellMeters));
    const r1 = Math.min(this.rows - 1, Math.floor((py + maxDist - this.minY) / this.cellMeters));
    if (++this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    let best = maxDist;
    let bestSeg = -1;
    const { x, y } = this;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = r * this.cols + c;
        for (let j = this.cellStart[cell]!; j < this.cellStart[cell + 1]!; j++) {
          const i = this.cellSeg[j]!;
          if (this.seen[i] === this.stamp) continue;
          this.seen[i] = this.stamp;
          const d = pointSegmentDistance(px, py, x[i]!, y[i]!, x[i + 1]!, y[i + 1]!);
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
      const dx = x[i + 1]! - x[i]!;
      const dy = y[i + 1]! - y[i]!;
      const l = Math.hypot(dx, dy);
      if (i === bestSeg) {
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x[i]!) * dx + (py - y[i]!) * dy) / len2));
        before = total;
        along = t * l;
        qx = x[i]! + t * dx;
        qy = y[i]! + t * dy;
      }
      total += l;
    }
    return { edge: e, t: total === 0 ? 0 : (before + along) / total, lon: P.lon(qx), lat: P.lat(qy), dist: best };
  }
}
