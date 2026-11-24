import { describe, expect, it } from 'vitest';
import { Router } from '../src/core/astar.ts';
import { LEVELS, computeArcCosts } from '../src/core/cost.ts';
import { assembleRoute, pointOnEdge } from '../src/core/route.ts';
import { SnapIndex } from '../src/core/snap.ts';
import { type EdgeSpec, rng, tinyGraph } from './helpers/graph.ts';

describe('A* on a hand-made graph', () => {
  //  0 ──(PAVE 100)── 1
  //  │                │
  // (SMOOTH 100)  (SMOOTH 100)
  //  │                │
  //  2 ──(SMOOTH 100)─ 3
  const g = tinyGraph(
    [
      [0, 0],
      [100, 0],
      [0, -100],
      [100, -100],
    ],
    [
      { a: 0, b: 1, fwd: { cls: 'PAVE' }, bwd: { cls: 'PAVE' } },
      { a: 0, b: 2 },
      { a: 2, b: 3 },
      { a: 3, b: 1 },
    ],
  );
  const router = new Router(g);
  const at = (edge: number, t: number) => ({ edge, t, ...pointOnEdge(g, edge, t) });

  it('level 0 takes the short pavé, level 2 the smooth detour', () => {
    const r0 = router.search(computeArcCosts(g, LEVELS[0]!.penalties), at(1, 0.01), at(3, 0.99))!;
    const r2 = router.search(computeArcCosts(g, LEVELS[2]!.penalties), at(1, 0.01), at(3, 0.99))!;
    expect(assembleRoute(g, r0).stats.paveM).toBeCloseTo(100, 0);
    expect(assembleRoute(g, r2).stats.paveM).toBe(0);
    expect(assembleRoute(g, r2).stats.distance).toBeCloseTo(298, 0); // 99 + 100 + 99 m
  });

  it('handles start and end on the same edge, both directions', () => {
    const costs = computeArcCosts(g, LEVELS[0]!.penalties);
    const fwd = router.search(costs, at(2, 0.2), at(2, 0.7))!;
    expect(fwd.cost).toBeCloseTo(50, 3);
    const back = router.search(costs, at(2, 0.7), at(2, 0.2))!;
    expect(back.cost).toBeCloseTo(50, 3);
  });

  it('respects oneways', () => {
    const one = tinyGraph(
      [
        [0, 0],
        [100, 0],
        [50, 80],
      ],
      [{ a: 0, b: 1, bwd: null }, { a: 1, b: 2 }, { a: 2, b: 0 }],
    );
    const r = new Router(one);
    const costs = computeArcCosts(one, LEVELS[0]!.penalties);
    const p = (edge: number, t: number) => ({ edge, t, ...pointOnEdge(one, edge, t) });
    // from the middle of 0→1 back to its start: must go round via 1 → 2 → 0
    const res = r.search(costs, p(0, 0.5), p(0, 0.1))!;
    expect(res.cost).toBeGreaterThan(200);
  });

  it('snaps to the nearest rideable edge within 100 m', () => {
    const snap = new SnapIndex(g);
    const s = snap.nearest(pointOnEdge(g, 2, 0.5).lon, pointOnEdge(g, 2, 0.5).lat + 0.0003)!; // ~33 m north of edge 2
    expect(s.edge).not.toBe(-1);
    expect(s.dist).toBeLessThan(40);
    expect(snap.nearest(pointOnEdge(g, 2, 0.5).lon, pointOnEdge(g, 2, 0.5).lat - 0.005)).toBeNull(); // ~500 m south
  });
});

describe('A* equals Dijkstra on a random grid', () => {
  // 12×12 grid, 50 m spacing, random classes, some oneways and pushes
  const R = rng(42);
  const N = 12;
  const nodes: [number, number][] = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) nodes.push([j * 50 + (R() - 0.5) * 10, i * 50 + (R() - 0.5) * 10]);
  const classes = ['SMOOTH', 'SLABS', 'PAVE', 'LOOSE', 'UNKNOWN'] as const;
  const edges: EdgeSpec[] = [];
  const pick = () => classes[Math.floor(R() * classes.length)]!;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const id = i * N + j;
      for (const nb of [j + 1 < N ? id + 1 : -1, i + 1 < N ? id + N : -1]) {
        if (nb < 0) continue;
        const cls = pick();
        const oneway = R() < 0.2;
        edges.push({ a: id, b: nb, fwd: { cls }, bwd: oneway ? { cls, push: true } : { cls }, rail: R() < 0.15 ? 50 : 0, cross: R() < 0.1 ? 1 : 0 });
      }
    }
  }
  const g = tinyGraph(nodes, edges);
  const router = new Router(g);
  it('identical costs on 200 random pairs at every level', () => {
    for (const lvl of LEVELS) {
      const costs = computeArcCosts(g, lvl.penalties);
      for (let k = 0; k < 50; k++) {
        const e1 = Math.floor(R() * edges.length);
        const e2 = Math.floor(R() * edges.length);
        const a = { edge: e1, t: R(), ...pointOnEdge(g, e1, 0) };
        Object.assign(a, pointOnEdge(g, e1, a.t));
        const b = { edge: e2, t: R(), ...pointOnEdge(g, e2, 0) };
        Object.assign(b, pointOnEdge(g, e2, b.t));
        const astar = router.search(costs, a, b)!;
        const dijkstra = router.search(costs, a, b, { heuristic: false })!;
        expect(astar.cost).toBeCloseTo(dijkstra.cost, 6);
      }
    }
  });
});
