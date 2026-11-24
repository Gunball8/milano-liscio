import { describe, expect, it } from 'vitest';
import { type CorrectionRecord, EdgeLookup, resolveCorrections, surfaceFeatures } from '../src/core/corrections.ts';
import { DEFAULT_FACTORS, LEVELS, scaledPenalties } from '../src/core/cost.ts';
import { MILAN_PROJECTION as P } from '../src/core/geo.ts';
import { tinyGraph } from './helpers/graph.ts';

const ll = (x: number, y = 0): [number, number] => [P.lon(x), P.lat(y)];

// Via A: 0 → 100 → 200 (two edges of way 10, then way 11, both named "Via A"), smooth; Via B: pavé with rails.
const g = tinyGraph(
  [
    [0, 0],
    [100, 0],
    [200, 0],
    [300, 0],
    [200, 100],
  ],
  [
    { a: 0, b: 1, wayId: 10, name: 'Via A' },
    { a: 1, b: 2, wayId: 10, name: 'Via A' },
    { a: 2, b: 3, wayId: 11, name: 'Via A' },
    { a: 2, b: 4, wayId: 20, name: 'Via B', fwd: { cls: 'PAVE' }, bwd: { cls: 'PAVE' }, rail: 100 },
  ],
);
const lookup = new EdgeLookup(g);
const rec = (o: Partial<CorrectionRecord>): CorrectionRecord => ({ id: 'c', wayId: 10, mid: ll(50), length: 100, name: 'Via A', source: 'manual', createdAt: 1, ...o });

describe('corrections (SPEC §9.3)', () => {
  it('reads OSM state and applies an override', () => {
    expect(lookup.osmState(0)).toEqual({ cls: 0, rail: false });
    expect(lookup.osmState(3)).toEqual({ cls: 2, rail: true });
    const { overrides, statuses } = resolveCorrections(lookup, [rec({ surface: 'PAVE' })]);
    expect(statuses).toEqual([{ id: 'c', edge: 0, state: 'ok' }]);
    expect(overrides.get(0)).toEqual({ cls: 2 });
    expect(lookup.effectiveState(0, overrides)).toEqual({ cls: 2, rail: false, corrected: true });
  });

  it('re-attaches by way id near the stored midpoint, else by name, else orphan', () => {
    // midpoint moved 10 m: same way, still found
    expect(resolveCorrections(lookup, [rec({ mid: ll(150, 10), surface: 'PAVE' })]).statuses[0]).toMatchObject({ edge: 1, state: 'ok' });
    // way id unknown after an OSM edit (way split), same name nearby
    expect(resolveCorrections(lookup, [rec({ wayId: 999, mid: ll(250, 5), surface: 'PAVE' })]).statuses[0]).toMatchObject({ edge: 2 });
    // nothing nearby with that way or name
    expect(resolveCorrections(lookup, [rec({ wayId: 999, name: 'Via Z', surface: 'PAVE' })]).statuses[0]).toMatchObject({ edge: -1, state: 'orphan' });
  });

  it('flags a correction identical to OSM as obsolete', () => {
    expect(resolveCorrections(lookup, [rec({ surface: 'SMOOTH', rails: false })]).statuses[0]!.state).toBe('obsolete');
    expect(resolveCorrections(lookup, [rec({ wayId: 20, mid: ll(200, 50), name: 'Via B', surface: 'PAVE' })]).statuses[0]!.state).toBe('obsolete');
    expect(resolveCorrections(lookup, [rec({ wayId: 20, mid: ll(200, 50), name: 'Via B', rails: false })]).statuses[0]!.state).toBe('ok');
  });

  it('a later correction wins on the same edge, fields merge', () => {
    const { overrides } = resolveCorrections(lookup, [rec({ id: 'b', surface: 'SLABS', createdAt: 2 }), rec({ id: 'a', surface: 'PAVE', rails: true, createdAt: 1 })]);
    expect(overrides.get(0)).toEqual({ cls: 1, rails: true });
  });

  it('whole street: contiguous edges with the same name only', () => {
    expect(lookup.streetEdges(0).sort()).toEqual([0, 1, 2]);
    expect(lookup.streetEdges(3)).toEqual([3]);
  });

  it('surface layer keeps degraded or corrected edges inside the viewport', () => {
    const box: [number, number, number, number] = [P.lon(-10), P.lat(-10), P.lon(310), P.lat(110)];
    expect(surfaceFeatures(lookup, new Map(), box).features.map((f) => f.properties.e)).toEqual([3]);
    const { overrides } = resolveCorrections(lookup, [rec({ surface: 'PAVE' })]);
    expect(surfaceFeatures(lookup, overrides, box).features.map((f) => f.properties.e).sort()).toEqual([0, 3]);
    const far: [number, number, number, number] = [P.lon(1000), P.lat(1000), P.lon(1100), P.lat(1100)];
    expect(surfaceFeatures(lookup, overrides, far).features).toEqual([]);
  });
});

describe('advanced penalties (SPEC §9.4)', () => {
  it('scales pavé, slabs, rails and crossings, nothing else', () => {
    const p = scaledPenalties(LEVELS[2]!.penalties, { pave: 2, slabs: 0.5, rails: 1.5, crossings: 0 });
    expect(p).toEqual({ surface: [0, 0.4, 8, 0.5, 0.05], rail: 4.5, crossing: 0 });
    expect(scaledPenalties(LEVELS[2]!.penalties, DEFAULT_FACTORS)).toEqual(LEVELS[2]!.penalties);
  });
});
