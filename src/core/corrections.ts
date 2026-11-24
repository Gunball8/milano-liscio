/**
 * User corrections (SPEC §9.3): model, attachment to graph edges (also after a data update), OSM vs
 * effective state of an edge, contiguous street, and the surface layer features. Pure TypeScript.
 */
import { SURFACE_CODE } from './classify.ts';
import type { EdgeCorrection } from './cost.ts';
import { MILAN_PROJECTION as P, pointSegmentDistance } from './geo.ts';
import { FLAG_CLASS_MASK, FLAG_PUSH, type Graph, edgeLngLats } from './graph.ts';

export type CorrectedSurface = 'SMOOTH' | 'SLABS' | 'PAVE';

/** Stored on the phone; the shape follows SPEC §9.3. */
export interface CorrectionRecord {
  id: string;
  wayId: number;
  /** Midpoint of the corrected edge, used to find it again after a data update. */
  mid: [number, number];
  length: number;
  name: string | null;
  surface?: CorrectedSurface;
  rails?: boolean;
  note?: string;
  source: 'manual' | 'report';
  createdAt: number;
}

export type CorrectionState = 'ok' | 'orphan' | 'obsolete';

export interface CorrectionStatus {
  id: string;
  /** Edge the correction applies to, -1 when orphan. */
  edge: number;
  state: CorrectionState;
}

/** Same way, nearest edge to the stored midpoint within 25 m (SPEC §9.3). */
export const REATTACH_WAY_M = 25;
/** Fallback on an edge of the same name; bounded so a namesake in another town never matches. */
export const REATTACH_NAME_M = 100;

export interface EdgeState {
  /** Surface code (SMOOTH 0, SLABS 1, PAVE 2, LOOSE 3, UNKNOWN 4). */
  cls: number;
  rail: boolean;
}

/** Indexes over a graph for corrections; built once per loaded graph. */
export class EdgeLookup {
  private readonly fwdArc: Int32Array;
  private readonly bwdArc: Int32Array;
  readonly rideable: Uint8Array;
  private wayIndex: Map<number, number> | null = null;
  private edgesOfWay: Map<number, number[]> | null = null;
  private edgesOfName: Map<number, number[]> | null = null;
  private nodeEdges: { start: Uint32Array; list: Uint32Array } | null = null;
  private bbox: Float32Array | null = null;

  constructor(readonly g: Graph) {
    const E = g.header.edgeCount;
    this.fwdArc = new Int32Array(E).fill(-1);
    this.bwdArc = new Int32Array(E).fill(-1);
    this.rideable = new Uint8Array(E);
    for (let a = 0; a < g.header.arcCount; a++) {
      const v = g.arcEdge[a]!;
      if (v >= 0) this.fwdArc[v] = a;
      else this.bwdArc[~v] = a;
      if ((g.arcFlags[a]! & FLAG_PUSH) === 0) this.rideable[v >= 0 ? v : ~v] = 1;
    }
  }

  /** State from OSM data: the class of the forward arc (else backward) and whether rails were detected. */
  osmState(e: number): EdgeState {
    const a = this.fwdArc[e]! >= 0 ? this.fwdArc[e]! : this.bwdArc[e]!;
    return { cls: a >= 0 ? this.g.arcFlags[a]! & FLAG_CLASS_MASK : 4, rail: a >= 0 && this.g.arcRail[a]! > 0 };
  }

  effectiveState(e: number, corrections?: ReadonlyMap<number, EdgeCorrection>): EdgeState & { corrected: boolean } {
    const osm = this.osmState(e);
    const c = corrections?.get(e);
    if (!c) return { ...osm, corrected: false };
    return { cls: c.cls ?? osm.cls, rail: c.rails ?? osm.rail, corrected: true };
  }

  wayOf(wayId: number): number | undefined {
    if (!this.wayIndex) {
      this.wayIndex = new Map();
      for (let w = 0; w < this.g.header.wayCount; w++) this.wayIndex.set(this.g.wayId[w]!, w);
    }
    return this.wayIndex.get(wayId);
  }

  private edgesByWay(way: number): number[] {
    if (!this.edgesOfWay) {
      this.edgesOfWay = new Map();
      for (let e = 0; e < this.g.header.edgeCount; e++) {
        const w = this.g.edgeWay[e]!;
        const list = this.edgesOfWay.get(w);
        if (list) list.push(e);
        else this.edgesOfWay.set(w, [e]);
      }
    }
    return this.edgesOfWay.get(way) ?? [];
  }

  private edgesByName(nameIdx: number): number[] {
    if (!this.edgesOfName) {
      this.edgesOfName = new Map();
      for (let e = 0; e < this.g.header.edgeCount; e++) {
        const n = this.g.wayName[this.g.edgeWay[e]!]!;
        if (n < 0) continue;
        const list = this.edgesOfName.get(n);
        if (list) list.push(e);
        else this.edgesOfName.set(n, [e]);
      }
    }
    return this.edgesOfName.get(nameIdx) ?? [];
  }

  distanceToEdge(e: number, lon: number, lat: number): number {
    const px = P.x(lon);
    const py = P.y(lat);
    const pts = edgeLngLats(this.g, e);
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const d = pointSegmentDistance(px, py, P.x(pts[i - 1]![0]), P.y(pts[i - 1]![1]), P.x(pts[i]![0]), P.y(pts[i]![1]));
      if (d < best) best = d;
    }
    return best;
  }

  /** Point at half the length of an edge. */
  midpoint(e: number): [number, number] {
    const pts = edgeLngLats(this.g, e);
    const seg = (i: number) => Math.hypot(P.x(pts[i]![0]) - P.x(pts[i - 1]![0]), P.y(pts[i]![1]) - P.y(pts[i - 1]![1]));
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += seg(i);
    let left = total / 2;
    for (let i = 1; i < pts.length; i++) {
      const l = seg(i);
      if (left <= l) {
        const f = l === 0 ? 0 : left / l;
        return [pts[i - 1]![0] + f * (pts[i]![0] - pts[i - 1]![0]), pts[i - 1]![1] + f * (pts[i]![1] - pts[i - 1]![1])];
      }
      left -= l;
    }
    return pts[0]!;
  }

  private nearestOf(edges: number[], lon: number, lat: number, maxM: number): number {
    let best = -1;
    let bestD = maxM;
    for (const e of edges) {
      const d = this.distanceToEdge(e, lon, lat);
      if (d <= bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Edge of a correction: same way near the midpoint, else same name nearby, else -1. */
  attach(c: CorrectionRecord): number {
    const way = this.wayOf(c.wayId);
    if (way !== undefined) {
      const e = this.nearestOf(this.edgesByWay(way), c.mid[0], c.mid[1], REATTACH_WAY_M);
      if (e >= 0) return e;
    }
    if (c.name) {
      const nameIdx = this.g.header.names.indexOf(c.name);
      if (nameIdx >= 0) return this.nearestOf(this.edgesByName(nameIdx), c.mid[0], c.mid[1], REATTACH_NAME_M);
    }
    return -1;
  }

  /** Edges of the same street connected to e ("Appliquer à toute la rue"), capped in total length. */
  streetEdges(e: number, maxLengthM = 6000): number[] {
    const g = this.g;
    const name = g.wayName[g.edgeWay[e]!]!;
    if (name < 0) return [e];
    if (!this.nodeEdges) {
      const N = g.header.nodeCount;
      const start = new Uint32Array(N + 1);
      for (let i = 0; i < g.header.edgeCount; i++) {
        start[g.edgeFrom[i]! + 1]!++;
        start[g.edgeTo[i]! + 1]!++;
      }
      for (let n = 0; n < N; n++) start[n + 1]! += start[n]!;
      const fill = start.slice(0, N);
      const list = new Uint32Array(g.header.edgeCount * 2);
      for (let i = 0; i < g.header.edgeCount; i++) {
        list[fill[g.edgeFrom[i]!]!++] = i;
        list[fill[g.edgeTo[i]!]!++] = i;
      }
      this.nodeEdges = { start, list };
    }
    const { start, list } = this.nodeEdges;
    const seen = new Set<number>([e]);
    const queue = [e];
    let total = g.edgeLength[e]!;
    while (queue.length > 0 && total < maxLengthM) {
      const cur = queue.shift()!;
      for (const node of [g.edgeFrom[cur]!, g.edgeTo[cur]!]) {
        for (let k = start[node]!; k < start[node + 1]!; k++) {
          const nb = list[k]!;
          if (seen.has(nb) || g.wayName[g.edgeWay[nb]!] !== name) continue;
          seen.add(nb);
          queue.push(nb);
          total += g.edgeLength[nb]!;
        }
      }
    }
    return [...seen];
  }

  /** Lazily computed bounding boxes (lon/lat) of every edge. */
  edgeBox(e: number): [number, number, number, number] {
    if (!this.bbox) {
      const b = new Float32Array(this.g.header.edgeCount * 4);
      for (let i = 0; i < this.g.header.edgeCount; i++) {
        let w = Infinity;
        let s = Infinity;
        let east = -Infinity;
        let n = -Infinity;
        for (const [x, y] of edgeLngLats(this.g, i)) {
          w = Math.min(w, x);
          east = Math.max(east, x);
          s = Math.min(s, y);
          n = Math.max(n, y);
        }
        b.set([w, s, east, n], i * 4);
      }
      this.bbox = b;
    }
    const o = e * 4;
    return [this.bbox[o]!, this.bbox[o + 1]!, this.bbox[o + 2]!, this.bbox[o + 3]!];
  }
}

/**
 * Applies the stored corrections to the current graph: attachment, obsolete detection (identical to
 * OSM now), later corrections winning on the same edge. Returns the per-edge overrides for routing.
 */
export function resolveCorrections(lookup: EdgeLookup, list: readonly CorrectionRecord[]): { statuses: CorrectionStatus[]; overrides: Map<number, EdgeCorrection> } {
  const statuses: CorrectionStatus[] = [];
  const overrides = new Map<number, EdgeCorrection>();
  for (const c of [...list].sort((a, b) => a.createdAt - b.createdAt)) {
    const edge = lookup.attach(c);
    if (edge < 0) {
      statuses.push({ id: c.id, edge: -1, state: 'orphan' });
      continue;
    }
    const osm = lookup.osmState(edge);
    const sameSurface = c.surface === undefined || SURFACE_CODE[c.surface] === osm.cls;
    const sameRails = c.rails === undefined || c.rails === osm.rail;
    statuses.push({ id: c.id, edge, state: sameSurface && sameRails ? 'obsolete' : 'ok' });
    const prev = overrides.get(edge) ?? {};
    overrides.set(edge, {
      ...prev,
      ...(c.surface !== undefined ? { cls: SURFACE_CODE[c.surface] } : {}),
      ...(c.rails !== undefined ? { rails: c.rails } : {}),
    });
  }
  return { statuses, overrides };
}

export interface SurfaceFeature {
  type: 'Feature';
  properties: { e: number; cls: number; rail: number; corrected: number };
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

/**
 * "Revêtements" layer (SPEC §9.3) for a viewport: rideable edges that are PAVE, SLABS, UNKNOWN, with
 * rails, or corrected. Smooth and loose edges are left out.
 */
export function surfaceFeatures(
  lookup: EdgeLookup,
  overrides: ReadonlyMap<number, EdgeCorrection>,
  [w, s, e, n]: [number, number, number, number],
  limit = 15_000,
): { features: SurfaceFeature[]; truncated: boolean } {
  const features: SurfaceFeature[] = [];
  for (let i = 0; i < lookup.g.header.edgeCount; i++) {
    const [bw, bs, be, bn] = lookup.edgeBox(i);
    if (be < w || bw > e || bn < s || bs > n) continue;
    const st = lookup.effectiveState(i, overrides);
    if (!lookup.rideable[i] && !st.corrected) continue;
    const show = st.cls === 2 || st.cls === 1 || st.cls === 4 || st.rail || st.corrected;
    if (!show) continue;
    if (features.length >= limit) return { features, truncated: true };
    features.push({
      type: 'Feature',
      properties: { e: i, cls: st.cls, rail: st.rail ? 1 : 0, corrected: st.corrected ? 1 : 0 },
      geometry: { type: 'LineString', coordinates: edgeLngLats(lookup.g, i) },
    });
  }
  return { features, truncated: false };
}
