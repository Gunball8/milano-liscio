/** Builds small in-memory graphs (through the real serializer) for unit tests. */
import { SURFACE_CODE, type SurfaceClass } from '../../src/core/classify.ts';
import { MILAN_PROJECTION as P } from '../../src/core/geo.ts';
import { COORD_SCALE, FLAG_PUSH, type Graph, parseGraph, serializeGraph } from '../../src/core/graph.ts';

export interface DirSpec {
  cls?: SurfaceClass;
  push?: boolean;
}
export interface EdgeSpec {
  a: number;
  b: number;
  /** null = direction not allowed. Default: SMOOTH ride. */
  fwd?: DirSpec | null;
  bwd?: DirSpec | null;
  rail?: number;
  cross?: number;
  /** Intermediate vertices in meters from the Duomo. */
  via?: [number, number][];
  /** OSM way id (default 1000 + edge index) and street name. */
  wayId?: number;
  name?: string;
}

/** nodes: [x, y] in meters from the Duomo. */
export function tinyGraph(nodes: [number, number][], edges: EdgeSpec[]): Graph {
  const ll = (x: number, y: number) => [Math.round(P.lon(x) * COORD_SCALE), Math.round(P.lat(y) * COORD_SCALE)] as const;
  const arcs: { from: number; to: number; edge: number; flags: number; rail: number; cross: number }[] = [];
  const coordLon: number[] = [];
  const coordLat: number[] = [];
  const edgeCoordStart: number[] = [];
  const edgeLength: number[] = [];
  edges.forEach((e, i) => {
    const pts = [nodes[e.a]!, ...(e.via ?? []), nodes[e.b]!];
    edgeCoordStart.push(coordLon.length);
    let len = 0;
    pts.forEach(([x, y], k) => {
      if (k > 0 && k < pts.length - 1) {
        const [lo, la] = ll(x, y);
        coordLon.push(lo);
        coordLat.push(la);
      }
      if (k > 0) len += Math.hypot(x - pts[k - 1]![0], y - pts[k - 1]![1]);
    });
    edgeLength.push(len);
    const add = (d: DirSpec | null | undefined, rev: boolean) => {
      if (d === null) return;
      const spec = d ?? {};
      arcs.push({
        from: rev ? e.b : e.a,
        to: rev ? e.a : e.b,
        edge: rev ? ~i : i,
        flags: SURFACE_CODE[spec.cls ?? 'SMOOTH'] | (spec.push ? FLAG_PUSH : 0),
        rail: e.rail ?? 0,
        cross: e.cross ?? 0,
      });
    };
    add(e.fwd, false);
    add(e.bwd, true);
  });
  edgeCoordStart.push(coordLon.length);
  const n = nodes.length;
  const firstArc = new Uint32Array(n + 1);
  for (const a of arcs) firstArc[a.from + 1]!++;
  for (let i = 0; i < n; i++) firstArc[i + 1]! += firstArc[i]!;
  const fill = firstArc.slice(0, n);
  const arcTarget = new Uint32Array(arcs.length);
  const arcEdge = new Int32Array(arcs.length);
  const arcFlags = new Uint8Array(arcs.length);
  const arcRail = new Uint16Array(arcs.length);
  const arcCross = new Uint8Array(arcs.length);
  for (const a of arcs) {
    const i = fill[a.from]!++;
    arcTarget[i] = a.to;
    arcEdge[i] = a.edge;
    arcFlags[i] = a.flags;
    arcRail[i] = a.rail;
    arcCross[i] = a.cross;
  }
  const names = [...new Set(edges.map((e) => e.name).filter((v): v is string => !!v))];
  const bin = serializeGraph(
    { builtAt: '', osmBase: null, railD: 3, nodeCount: n, arcCount: arcs.length, edgeCount: edges.length, coordCount: coordLon.length, wayCount: edges.length, names },
    {
      nodeLon: Int32Array.from(nodes.map(([x, y]) => ll(x, y)[0])),
      nodeLat: Int32Array.from(nodes.map(([x, y]) => ll(x, y)[1])),
      firstArc,
      arcTarget,
      arcEdge,
      arcFlags,
      arcRail,
      arcCross,
      edgeLength: Float32Array.from(edgeLength),
      edgeFrom: Uint32Array.from(edges.map((e) => e.a)),
      edgeTo: Uint32Array.from(edges.map((e) => e.b)),
      edgeWay: Uint32Array.from(edges.map((_, i) => i)),
      edgeCoordStart: Uint32Array.from(edgeCoordStart),
      coordLon: Int32Array.from(coordLon),
      coordLat: Int32Array.from(coordLat),
      wayId: Float64Array.from(edges.map((e, i) => e.wayId ?? 1000 + i)),
      wayName: Int32Array.from(edges.map((e) => (e.name ? names.indexOf(e.name) : -1))),
      wayDay: new Uint16Array(edges.length),
    },
  );
  return parseGraph(bin.buffer as ArrayBuffer);
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
