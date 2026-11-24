/**
 * SPEC §12 checks on the real Milan graph (skipped until `pnpm data:graph` has run).
 * 200 deterministic random pairs between rideable edges.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Router, type EdgePoint, type SearchResult } from '../src/core/astar.ts';
import { type Tags, directionalAccess } from '../src/core/classify.ts';
import { LEVELS, computeArcCosts } from '../src/core/cost.ts';
import { FLAG_PUSH, type Graph, arcEdgeIndex, arcReversed, parseGraph } from '../src/core/graph.ts';
import { assembleRoute, pointOnEdge } from '../src/core/route.ts';
import { rng } from './helpers/graph.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const GRAPH = path.join(ROOT, 'public/data/milano-graph.bin');
const RAW = path.join(ROOT, 'data/raw/highways.json');
const PAIRS = 200;
const EPS = 0.5; // meters-equivalent, Float32 lengths

describe.skipIf(!existsSync(GRAPH))('real Milan graph (SPEC §12)', () => {
  let g: Graph;
  let router: Router;
  let costs: Float64Array[];
  const pairs: [EdgePoint, EdgePoint][] = [];

  beforeAll(() => {
    const buf = readFileSync(GRAPH);
    g = parseGraph(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    router = new Router(g);
    costs = LEVELS.map((l) => computeArcCosts(g, l.penalties));
    const R = rng(2026);
    const rideArcs: number[] = [];
    for (let a = 0; a < g.header.arcCount; a++) if ((g.arcFlags[a]! & FLAG_PUSH) === 0) rideArcs.push(a);
    const point = (): EdgePoint => {
      const e = arcEdgeIndex(g, rideArcs[Math.floor(R() * rideArcs.length)]!);
      const t = R();
      return { edge: e, t, ...pointOnEdge(g, e, t) };
    };
    for (let i = 0; i < PAIRS; i++) pairs.push([point(), point()]);
  });

  const costAlong = (res: SearchResult, c: Float64Array) => res.pieces.reduce((s, p) => s + c[p.arc]! * (p.t1 - p.t0), 0);

  it('A* cost equals Dijkstra cost on 200 random pairs (levels 2 and 3)', { timeout: 300_000 }, () => {
    let unreachable = 0;
    for (const lvl of [2, 3]) {
      for (const [a, b] of pairs) {
        const astar = router.search(costs[lvl]!, a, b);
        const dijkstra = router.search(costs[lvl]!, a, b, { heuristic: false });
        if (!dijkstra) {
          expect(astar).toBeNull();
          unreachable++;
          continue;
        }
        expect(astar).not.toBeNull();
        expect(Math.abs(astar!.cost - dijkstra.cost)).toBeLessThan(EPS);
      }
    }
    expect(unreachable).toBeLessThan(PAIRS * 0.02);
  });

  it('invariants between levels 0 and 3 on 200 random pairs', { timeout: 120_000 }, () => {
    const unexplained: string[] = [];
    let shorterByPushing = 0;
    let morePave = 0;
    for (const [i, [a, b]] of pairs.entries()) {
      const r0 = router.search(costs[0]!, a, b);
      const r3 = router.search(costs[3]!, a, b);
      if (!r0 || !r3) continue;
      const s0 = assembleRoute(g, r0).stats;
      const s3 = assembleRoute(g, r3).stats;
      // Exact invariant: level 0 is optimal for its own cost, so the level-3 route cannot beat it there.
      expect(costAlong(r3, costs[0]!)).toBeGreaterThanOrEqual(r0.cost - EPS);
      // SPEC wording "distance(level 3) ≥ distance(level 0)": holds unless level 3 walks more (push ×3.5).
      if (s3.distance < s0.distance - EPS) {
        if (s3.pushM > s0.pushM) shorterByPushing++;
        else unexplained.push(`pair ${i}: level 3 shorter (${s3.distance.toFixed(0)} < ${s0.distance.toFixed(0)}) without more pushing`);
      }
      if (s3.paveM > s0.paveM + EPS) {
        morePave++;
        unexplained.push(`pair ${i}: level 3 has more pavé (${s3.paveM.toFixed(0)} > ${s0.paveM.toFixed(0)})`);
      }
    }
    console.log(`invariants: ${shorterByPushing} pairs where level 3 is shorter because it walks more, ${morePave} with more pavé`);
    expect(unexplained).toEqual([]);
  });

  it.skipIf(!existsSync(RAW))('never rides against a oneway (levels 0, 2, 3)', { timeout: 120_000 }, () => {
    const tagsById = new Map<number, Tags>();
    for (const e of (JSON.parse(readFileSync(RAW, 'utf8')) as { elements: { id: number; tags: Tags }[] }).elements) tagsById.set(e.id, e.tags);
    const violations: string[] = [];
    for (const lvl of [0, 2, 3]) {
      for (const [a, b] of pairs) {
        const res = router.search(costs[lvl]!, a, b);
        if (!res) continue;
        for (const p of res.pieces) {
          if (g.arcFlags[p.arc]! & FLAG_PUSH) continue;
          const wayId = g.wayId[g.edgeWay[arcEdgeIndex(g, p.arc)]!]!;
          const acc = directionalAccess(tagsById.get(wayId)!);
          const mode = arcReversed(g, p.arc) ? acc.backward : acc.forward;
          if (mode !== 'ride') violations.push(`way ${wayId} ridden ${arcReversed(g, p.arc) ? 'backward' : 'forward'} (allowed: ${mode})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
