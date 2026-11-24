/**
 * A* (or Dijkstra) between two points lying on edges (SPEC §7). Scores live in arrays reused across
 * queries and invalidated with a stamp, so no per-query allocation proportional to the graph.
 *
 * Start and end are virtual nodes: SRC = nodeCount, TGT = nodeCount + 1. A path is a list of arc
 * pieces; the first and last may be partial (fractions measured along the arc's own direction).
 */
import { MILAN_PROJECTION as P } from './geo.ts';
import { COORD_SCALE, type Graph, findArc } from './graph.ts';

/** A point on an edge: t is the fraction of the edge length from edgeFrom (forward geometry). */
export interface EdgePoint {
  edge: number;
  t: number;
  lon: number;
  lat: number;
}

export interface PathPiece {
  arc: number;
  /** Covered fraction of the arc, 0 = arc source, 1 = arc target. */
  t0: number;
  t1: number;
}

export interface SearchResult {
  cost: number;
  pieces: PathPiece[];
  /** Nodes settled, for diagnostics. */
  settled: number;
}

/** Keeps the heuristic strictly below path length despite Float32 lengths and Int32 coordinates. */
const HEURISTIC_SLACK = 0.9999;

class MinHeap {
  private keys = new Float64Array(1024);
  private vals = new Int32Array(1024);
  size = 0;
  clear() {
    this.size = 0;
  }
  push(key: number, val: number) {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      k.set(this.keys);
      this.keys = k;
      const v = new Int32Array(this.size * 2);
      v.set(this.vals);
      this.vals = v;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= key) break;
      this.keys[i] = this.keys[p]!;
      this.vals[i] = this.vals[p]!;
      i = p;
    }
    this.keys[i] = key;
    this.vals[i] = val;
  }
  /** Removes the minimum and returns its value (key in lastKey). */
  lastKey = 0;
  pop(): number {
    const top = this.vals[0]!;
    this.lastKey = this.keys[0]!;
    const n = --this.size;
    if (n > 0) {
      const key = this.keys[n]!;
      const val = this.vals[n]!;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.keys[c + 1]! < this.keys[c]!) c++;
        if (this.keys[c]! >= key) break;
        this.keys[i] = this.keys[c]!;
        this.vals[i] = this.vals[c]!;
        i = c;
      }
      this.keys[i] = key;
      this.vals[i] = val;
    }
    return top;
  }
}

export class Router {
  readonly nodeX: Float64Array;
  readonly nodeY: Float64Array;
  private readonly n: number;
  private readonly g: Float64Array;
  private readonly prevNode: Int32Array;
  private readonly prevArc: Int32Array;
  private readonly pieceT0: Float64Array;
  private readonly pieceT1: Float64Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private stamp = 0;
  private readonly heap = new MinHeap();

  constructor(private readonly graph: Graph) {
    const n = graph.header.nodeCount;
    this.n = n;
    this.nodeX = new Float64Array(n);
    this.nodeY = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.nodeX[i] = P.x(graph.nodeLon[i]! / COORD_SCALE);
      this.nodeY[i] = P.y(graph.nodeLat[i]! / COORD_SCALE);
    }
    this.g = new Float64Array(n + 2);
    this.prevNode = new Int32Array(n + 2);
    this.prevArc = new Int32Array(n + 2);
    this.pieceT0 = new Float64Array(n + 2);
    this.pieceT1 = new Float64Array(n + 2);
    this.seen = new Uint32Array(n + 2);
    this.closed = new Uint32Array(n + 2);
  }

  private relax(node: number, score: number, from: number, arc: number, t0: number, t1: number, h: number) {
    if (this.seen[node] === this.stamp && this.g[node]! <= score) return;
    this.seen[node] = this.stamp;
    this.g[node] = score;
    this.prevNode[node] = from;
    this.prevArc[node] = arc;
    this.pieceT0[node] = t0;
    this.pieceT1[node] = t1;
    this.heap.push(score + h, node);
  }

  /**
   * Cheapest path between two edge points for the given arc costs.
   * `heuristic: false` turns A* into Dijkstra (used by tests).
   */
  search(costs: Float64Array, src: EdgePoint, dst: EdgePoint, opts: { heuristic?: boolean } = {}): SearchResult | null {
    const G = this.graph;
    const useH = opts.heuristic !== false;
    const SRC = this.n;
    const TGT = this.n + 1;
    this.stamp++;
    if (this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.stamp = 1;
    }
    this.heap.clear();
    const tx = P.x(dst.lon);
    const ty = P.y(dst.lat);
    const h = (node: number) => (useH ? Math.hypot(this.nodeX[node]! - tx, this.nodeY[node]! - ty) * HEURISTIC_SLACK : 0);

    // Arcs along the source and target edges (-1 when that direction is not allowed).
    const sF = findArc(G, src.edge, false, G.edgeFrom[src.edge]!);
    const sB = findArc(G, src.edge, true, G.edgeTo[src.edge]!);
    const dF = findArc(G, dst.edge, false, G.edgeFrom[dst.edge]!);
    const dB = findArc(G, dst.edge, true, G.edgeTo[dst.edge]!);
    const ok = (a: number) => a >= 0 && Number.isFinite(costs[a]!);

    this.seen[SRC] = this.stamp;
    this.g[SRC] = 0;
    if (ok(sF)) this.relax(G.edgeTo[src.edge]!, (1 - src.t) * costs[sF]!, SRC, sF, src.t, 1, h(G.edgeTo[src.edge]!));
    if (ok(sB)) this.relax(G.edgeFrom[src.edge]!, src.t * costs[sB]!, SRC, sB, 1 - src.t, 1, h(G.edgeFrom[src.edge]!));
    if (src.edge === dst.edge) {
      if (ok(sF) && dst.t >= src.t) this.relax(TGT, (dst.t - src.t) * costs[sF]!, SRC, sF, src.t, dst.t, 0);
      if (ok(sB) && dst.t <= src.t) this.relax(TGT, (src.t - dst.t) * costs[sB]!, SRC, sB, 1 - src.t, 1 - dst.t, 0);
    }
    const fromF = ok(dF) ? G.edgeFrom[dst.edge]! : -1;
    const fromB = ok(dB) ? G.edgeTo[dst.edge]! : -1;

    let settled = 0;
    while (this.heap.size > 0) {
      const u = this.heap.pop();
      if (this.closed[u] === this.stamp) continue;
      this.closed[u] = this.stamp;
      settled++;
      if (u === TGT) break;
      const gu = this.g[u]!;
      if (u === fromF) this.relax(TGT, gu + dst.t * costs[dF]!, u, dF, 0, dst.t, 0);
      if (u === fromB) this.relax(TGT, gu + (1 - dst.t) * costs[dB]!, u, dB, 0, 1 - dst.t, 0);
      for (let a = G.firstArc[u]!, end = G.firstArc[u + 1]!; a < end; a++) {
        const c = costs[a]!;
        if (c === Infinity) continue;
        const v = G.arcTarget[a]!;
        if (this.closed[v] === this.stamp) continue;
        this.relax(v, gu + c, u, a, 0, 1, h(v));
      }
    }
    if (this.closed[TGT] !== this.stamp) return null;

    const pieces: PathPiece[] = [];
    for (let node = TGT; node !== SRC; node = this.prevNode[node]!) {
      pieces.push({ arc: this.prevArc[node]!, t0: this.pieceT0[node]!, t1: this.pieceT1[node]! });
    }
    pieces.reverse();
    return { cost: this.g[TGT]!, pieces, settled };
  }
}
