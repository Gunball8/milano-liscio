/**
 * Cost model in "equivalent meters" (SPEC §7):
 *   cost(arc) = L × pushFactor + L × surfacePenalty[class] + railLen × railPenalty + shallowCrossings × crossingMeters
 * Every factor is ≥ 1 per meter, so the straight-line distance is an admissible A* heuristic.
 */
import { FLAG_CLASS_MASK, FLAG_PUSH, type Graph, arcEdgeIndex } from './graph.ts';

export const PUSH_FACTOR = 3.5;

export interface Penalties {
  /** Extra meters per meter, indexed by surface code: SMOOTH, SLABS, PAVE, LOOSE, UNKNOWN. */
  surface: readonly [number, number, number, number, number];
  /** Extra meters per meter along embedded rails. */
  rail: number;
  /** Extra meters per shallow rail crossing. */
  crossing: number;
}

export interface Level {
  id: 0 | 1 | 2 | 3;
  label: string;
  penalties: Penalties;
}

/** Starting values from the brief, to be validated at the end of phase 1 (docs/calibration.md). */
export const LEVELS: readonly Level[] = [
  { id: 0, label: 'Court', penalties: { surface: [0, 0, 0, 0, 0], rail: 0, crossing: 0 } },
  { id: 1, label: 'Équilibré', penalties: { surface: [0, 0.3, 1.5, 0.5, 0.05], rail: 1, crossing: 10 } },
  { id: 2, label: 'Lisse', penalties: { surface: [0, 0.8, 4, 0.5, 0.05], rail: 3, crossing: 25 } },
  { id: 3, label: 'Zéro pavé', penalties: { surface: [0, 3, 30, 0.5, 0.05], rail: 15, crossing: 60 } },
];

/** "Pénalités avancées" (SPEC §9.4): multipliers applied to every level's penalties. 1 = brief values. */
export interface PenaltyFactors {
  pave: number;
  slabs: number;
  rails: number;
  crossings: number;
}

export const DEFAULT_FACTORS: PenaltyFactors = { pave: 1, slabs: 1, rails: 1, crossings: 1 };

export function scaledPenalties(p: Penalties, f: PenaltyFactors): Penalties {
  return {
    surface: [p.surface[0], p.surface[1] * f.slabs, p.surface[2] * f.pave, p.surface[3], p.surface[4]],
    rail: p.rail * f.rails,
    crossing: p.crossing * f.crossings,
  };
}

/** User correction on one edge (SPEC §9.3): replaces surface class and/or rails before costing. */
export interface EdgeCorrection {
  /** Surface code (see SURFACE_CODE). */
  cls?: number;
  rails?: boolean;
}

export type Corrections = ReadonlyMap<number, EdgeCorrection>;

export interface CostOptions {
  /** "Autoriser les passages à pied" setting (§9.4). Default true. */
  allowPush?: boolean;
}

/** Surface class and rail length of an arc after corrections. */
export function effectiveArc(g: Graph, arc: number, corrections?: Corrections): { cls: number; rail: number; length: number; push: boolean } {
  const e = arcEdgeIndex(g, arc);
  const length = g.edgeLength[e]!;
  const flags = g.arcFlags[arc]!;
  let cls = flags & FLAG_CLASS_MASK;
  let rail = g.arcRail[arc]!;
  const c = corrections?.get(e);
  if (c) {
    if (c.cls !== undefined) cls = c.cls;
    if (c.rails !== undefined) rail = c.rails ? length : 0;
  }
  return { cls, rail, length, push: (flags & FLAG_PUSH) !== 0 };
}

export function arcCost(g: Graph, arc: number, p: Penalties, corrections?: Corrections, opts: CostOptions = {}): number {
  const { cls, rail, length, push } = effectiveArc(g, arc, corrections);
  if (push && opts.allowPush === false) return Infinity;
  return length * (push ? PUSH_FACTOR : 1) + length * p.surface[cls as 0 | 1 | 2 | 3 | 4] + rail * p.rail + g.arcCross[arc]! * p.crossing;
}

/** Cost of every arc for one penalty set. Recompute after corrections or setting changes (a few ms). */
export function computeArcCosts(g: Graph, p: Penalties, corrections?: Corrections, opts: CostOptions = {}): Float64Array {
  const out = new Float64Array(g.header.arcCount);
  for (let a = 0; a < out.length; a++) out[a] = arcCost(g, a, p, corrections, opts);
  return out;
}
