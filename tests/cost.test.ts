import { describe, expect, it } from 'vitest';
import { LEVELS, PUSH_FACTOR, arcCost, computeArcCosts } from '../src/core/cost.ts';
import { tinyGraph } from './helpers/graph.ts';

// One 100 m edge, both directions: forward = PAVE ride with 100 m rails and 1 shallow crossing, backward = SMOOTH push.
const g = tinyGraph(
  [
    [0, 0],
    [100, 0],
  ],
  [{ a: 0, b: 1, fwd: { cls: 'PAVE' }, bwd: { cls: 'SMOOTH', push: true }, rail: 100, cross: 1 }],
);
const fwd = 0; // arcs of node 0 come first
const bwd = 1;
const L = g.edgeLength[0]!;

describe('cost model (SPEC §7)', () => {
  it('level values: PAVE + rails add up, crossings in meters', () => {
    expect(L).toBeCloseTo(100, 3);
    expect(arcCost(g, fwd, LEVELS[0]!.penalties)).toBeCloseTo(L, 6);
    expect(arcCost(g, fwd, LEVELS[1]!.penalties)).toBeCloseTo(L * (1 + 1.5) + 100 * 1 + 10, 3);
    // level 2: ×8 for pavé + rails, plus 25 m for the crossing
    expect(arcCost(g, fwd, LEVELS[2]!.penalties)).toBeCloseTo(L * (1 + 4) + 100 * 3 + 25, 3);
    expect(arcCost(g, fwd, LEVELS[3]!.penalties)).toBeCloseTo(L * (1 + 30) + 100 * 15 + 60, 3);
  });

  it('pushing multiplies length by 3.5 and can be forbidden', () => {
    expect(arcCost(g, bwd, LEVELS[0]!.penalties)).toBeCloseTo(L * PUSH_FACTOR + 60 * 0, 3);
    expect(arcCost(g, bwd, LEVELS[0]!.penalties, undefined, { allowPush: false })).toBe(Infinity);
  });

  it('corrections replace class and rails before costing', () => {
    const smooth = new Map([[0, { cls: 0, rails: false }]]);
    expect(arcCost(g, fwd, LEVELS[2]!.penalties, smooth)).toBeCloseTo(L + 25, 3);
    const paveOnly = new Map([[0, { rails: false }]]);
    expect(arcCost(g, fwd, LEVELS[2]!.penalties, paveOnly)).toBeCloseTo(L * 5 + 25, 3);
    const railsYes = new Map([[0, { cls: 0, rails: true }]]);
    expect(arcCost(g, fwd, LEVELS[3]!.penalties, railsYes)).toBeCloseTo(L + L * 15 + 60, 3);
  });

  it('every cost is at least the length (admissible heuristic)', () => {
    for (const lvl of LEVELS) for (const c of computeArcCosts(g, lvl.penalties)) expect(c).toBeGreaterThanOrEqual(L * 0.9999);
  });
});
