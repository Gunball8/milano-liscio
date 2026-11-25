/**
 * The optimized paths (typed-array costs, CSR snapping grid, edge grid for the surface layer) must give
 * exactly what the straightforward computation gives. Checked on the real Milan graph.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { EdgeLookup } from '../src/core/corrections.ts';
import { LEVELS, arcCost, computeArcCosts } from '../src/core/cost.ts';
import { MILAN_PROJECTION as P, pointSegmentDistance } from '../src/core/geo.ts';
import { FLAG_PUSH, type Graph, arcEdgeIndex, edgeLngLats, parseGraph } from '../src/core/graph.ts';
import { SnapIndex } from '../src/core/snap.ts';
import { rng } from './helpers/graph.ts';

const GRAPH = path.resolve(import.meta.dirname, '../public/data/milano-graph.bin');

describe.skipIf(!existsSync(GRAPH))('optimized computations match the reference ones (real graph)', () => {
  let g: Graph;
  beforeAll(() => {
    const b = readFileSync(GRAPH);
    g = parseGraph(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  });

  it('computeArcCosts equals arcCost on every arc, with corrections and without pushing', () => {
    const R = rng(7);
    const corrections = new Map<number, { cls?: number; rails?: boolean }>();
    for (let i = 0; i < 500; i++) corrections.set(Math.floor(R() * g.header.edgeCount), R() < 0.5 ? { cls: 2 } : { cls: 0, rails: R() < 0.5 });
    for (const lvl of LEVELS) {
      for (const [corr, opts] of [
        [undefined, {}],
        [corrections, {}],
        [corrections, { allowPush: false }],
      ] as const) {
        const fast = computeArcCosts(g, lvl.penalties, corr, opts);
        let mismatches = 0;
        for (let a = 0; a < g.header.arcCount; a++) if (fast[a] !== arcCost(g, a, lvl.penalties, corr, opts)) mismatches++;
        expect(mismatches).toBe(0);
      }
    }
  });

  it('SnapIndex finds the same nearest distance as an exhaustive search (200 points)', { timeout: 120_000 }, () => {
    const snap = new SnapIndex(g);
    const rideable = new Uint8Array(g.header.edgeCount);
    for (let a = 0; a < g.header.arcCount; a++) if ((g.arcFlags[a]! & FLAG_PUSH) === 0) rideable[arcEdgeIndex(g, a)] = 1;
    const segs: number[] = [];
    for (let e = 0; e < g.header.edgeCount; e++) {
      if (!rideable[e]) continue;
      const pts = edgeLngLats(g, e).map(([lon, lat]) => [P.x(lon), P.y(lat)]);
      for (let i = 1; i < pts.length; i++) segs.push(pts[i - 1]![0]!, pts[i - 1]![1]!, pts[i]![0]!, pts[i]![1]!);
    }
    const R = rng(11);
    for (let k = 0; k < 200; k++) {
      const lon = 9.07 + R() * 0.2;
      const lat = 45.4 + R() * 0.12;
      const px = P.x(lon);
      const py = P.y(lat);
      let best = Infinity;
      for (let i = 0; i < segs.length; i += 4) best = Math.min(best, pointSegmentDistance(px, py, segs[i]!, segs[i + 1]!, segs[i + 2]!, segs[i + 3]!));
      const s = snap.nearest(lon, lat, 100);
      if (best > 100) expect(s).toBeNull();
      else expect(s!.dist).toBeCloseTo(best, 1); // Float32 point storage: centimetre agreement
    }
  });

  it('edgesInBox equals a full scan of edge boxes (50 viewports)', () => {
    const lookup = new EdgeLookup(g);
    const R = rng(3);
    for (let k = 0; k < 50; k++) {
      const w = 9.05 + R() * 0.22;
      const s = 45.39 + R() * 0.13;
      const e = w + 0.002 + R() * 0.03;
      const n = s + 0.002 + R() * 0.02;
      const scan: number[] = [];
      for (let i = 0; i < g.header.edgeCount; i++) {
        const [bw, bs, be, bn] = lookup.edgeBox(i);
        if (!(be < w || bw > e || bn < s || bs > n)) scan.push(i);
      }
      expect(lookup.edgesInBox(w, s, e, n)).toEqual(scan);
    }
  });
});
