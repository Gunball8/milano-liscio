/**
 * Spatial detection of tram rails embedded in carriageways (SPEC §6.3, rule 2).
 * Build-time only: the app reads the precomputed railLen from the graph file.
 */
import { MILAN_PROJECTION as P, lineAngleDiff, pointSegmentDistance } from '../../src/core/geo.ts';

export const SAMPLE_STEP_M = 10;
export const MAX_ANGLE_DEG = 20;
export const MARK_MIN_M = 30;
export const MARK_MIN_SHARE = 0.3;

export interface RailInput {
  /** Geographic coordinates [lon, lat] of the rail way. */
  coords: [number, number][];
  layer: number;
}

/** Uniform grid over rail segments; each segment is registered in every cell its padded bbox touches. */
export class RailIndex {
  readonly seg: Float64Array;
  readonly layer: Int8Array;
  private readonly cells = new Map<number, number[]>();

  constructor(
    rails: RailInput[],
    readonly padMeters: number,
    readonly cellMeters = 20,
  ) {
    const segs: number[] = [];
    const layers: number[] = [];
    for (const r of rails) {
      for (let i = 1; i < r.coords.length; i++) {
        const [lon1, lat1] = r.coords[i - 1]!;
        const [lon2, lat2] = r.coords[i]!;
        segs.push(P.x(lon1), P.y(lat1), P.x(lon2), P.y(lat2));
        layers.push(r.layer);
      }
    }
    this.seg = Float64Array.from(segs);
    this.layer = Int8Array.from(layers);
    const nSeg = layers.length;
    for (let s = 0; s < nSeg; s++) {
      const x1 = this.seg[4 * s]!;
      const y1 = this.seg[4 * s + 1]!;
      const x2 = this.seg[4 * s + 2]!;
      const y2 = this.seg[4 * s + 3]!;
      const c0 = Math.floor((Math.min(x1, x2) - padMeters) / cellMeters);
      const c1 = Math.floor((Math.max(x1, x2) + padMeters) / cellMeters);
      const r0 = Math.floor((Math.min(y1, y2) - padMeters) / cellMeters);
      const r1 = Math.floor((Math.max(y1, y2) + padMeters) / cellMeters);
      for (let c = c0; c <= c1; c++) {
        for (let r = r0; r <= r1; r++) {
          const k = c * 100_000 + r;
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(s);
        }
      }
    }
  }

  get segmentCount(): number {
    return this.layer.length;
  }

  candidates(x: number, y: number): number[] {
    return this.cells.get(Math.floor(x / this.cellMeters) * 100_000 + Math.floor(y / this.cellMeters)) ?? [];
  }

  /**
   * Distance to the nearest rail segment on the same layer whose direction is within maxAngle
   * of (dx, dy); Infinity if none within padMeters.
   */
  nearestAligned(x: number, y: number, dx: number, dy: number, layer: number, maxAngle = MAX_ANGLE_DEG): number {
    let best = Infinity;
    for (const s of this.candidates(x, y)) {
      if (this.layer[s] !== layer) continue;
      const ax = this.seg[4 * s]!;
      const ay = this.seg[4 * s + 1]!;
      const bx = this.seg[4 * s + 2]!;
      const by = this.seg[4 * s + 3]!;
      const d = pointSegmentDistance(x, y, ax, ay, bx, by);
      if (d >= best || d > this.padMeters) continue;
      if (lineAngleDiff(dx, dy, bx - ax, by - ay) > maxAngle) continue;
      best = d;
    }
    return best;
  }
}

export interface EdgeRailSamples {
  pieceLen: number;
  /** Per sample: distance to the nearest aligned rail, Infinity if none within the index padding. */
  dist: Float32Array;
}

/** Samples a projected polyline every ~10 m (centre of equal pieces) and measures the distance to aligned rails. */
export function sampleEdgeRails(xy: Float64Array, length: number, index: RailIndex, layer: number): EdgeRailSamples {
  const n = Math.max(1, Math.ceil(length / SAMPLE_STEP_M));
  const pieceLen = length / n;
  const dist = new Float32Array(n).fill(Infinity);
  let seg = 0;
  let segStart = 0; // cumulative length at the start of segment `seg`
  let segLen = Math.hypot(xy[2]! - xy[0]!, xy[3]! - xy[1]!);
  const nPts = xy.length / 2;
  for (let k = 0; k < n; k++) {
    const s = (k + 0.5) * pieceLen;
    while (s > segStart + segLen && seg < nPts - 2) {
      segStart += segLen;
      seg++;
      segLen = Math.hypot(xy[2 * seg + 2]! - xy[2 * seg]!, xy[2 * seg + 3]! - xy[2 * seg + 1]!);
    }
    const ax = xy[2 * seg]!;
    const ay = xy[2 * seg + 1]!;
    const dx = xy[2 * seg + 2]! - ax;
    const dy = xy[2 * seg + 3]! - ay;
    const t = segLen === 0 ? 0 : Math.min(1, Math.max(0, (s - segStart) / segLen));
    dist[k] = index.nearestAligned(ax + t * dx, ay + t * dy, dx, dy, layer);
  }
  return { pieceLen, dist };
}

export function railLength(samples: EdgeRailSamples, maxDist: number): number {
  let n = 0;
  for (const d of samples.dist) if (d <= maxDist) n++;
  return n * samples.pieceLen;
}

/** Edge flagged as "on rails" (SPEC §6.3): at least 30 m or 30 % of its length. */
export function isRailMarked(railLen: number, edgeLength: number): boolean {
  return railLen > 0 && (railLen >= MARK_MIN_M || railLen >= MARK_MIN_SHARE * edgeLength);
}

export function parseLayer(v: string | undefined): number {
  const n = Number.parseInt(v ?? '0', 10);
  return Number.isFinite(n) ? Math.max(-5, Math.min(5, n)) : 0;
}
