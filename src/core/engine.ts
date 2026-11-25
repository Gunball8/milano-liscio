/**
 * Routing facade used by the CLI and the worker: snapping, per-level costs (cached), and the
 * three computations per request of SPEC §7 (level 0, chosen level, level 3).
 */
import { Router } from './astar.ts';
import { type CostOptions, type Corrections, DEFAULT_FACTORS, LEVELS, type Level, type PenaltyFactors, computeArcCostsMulti, scaledPenalties } from './cost.ts';
import type { Graph } from './graph.ts';
import { type Route, type Speeds, DEFAULT_SPEEDS, assembleRoute } from './route.ts';
import { SNAP_MAX_M, SnapIndex, type Snapped } from './snap.ts';

export interface LevelRoute {
  level: Level;
  route: Route;
  /** Extra distance compared with level 0. */
  deltaM: number;
  deltaPct: number;
}

export type RouteError = 'start-off-network' | 'end-off-network' | 'no-route';

export type RouteResponse =
  | { ok: true; routes: LevelRoute[]; chosen: number; from: Snapped; to: Snapped; ms: number }
  | { ok: false; error: RouteError };

export interface Point {
  lon: number;
  lat: number;
}

export class RoutingEngine {
  readonly router: Router;
  readonly snap: SnapIndex;
  private costs: (Float64Array | null)[] = LEVELS.map(() => null);
  private corrections: Corrections | undefined;
  private costOptions: CostOptions = {};
  private factors: PenaltyFactors = DEFAULT_FACTORS;
  speeds: Speeds = DEFAULT_SPEEDS;

  constructor(readonly graph: Graph) {
    this.router = new Router(graph);
    this.snap = new SnapIndex(graph);
  }

  setCorrections(corrections: Corrections | undefined) {
    this.corrections = corrections;
    this.costs = LEVELS.map(() => null);
  }

  setCostOptions(opts: CostOptions) {
    this.costOptions = opts;
    this.costs = LEVELS.map(() => null);
  }

  setPenaltyFactors(f: PenaltyFactors) {
    this.factors = f;
    this.costs = LEVELS.map(() => null);
  }

  /** Costs of a level; every missing level is computed in the same pass over the arcs. */
  costsFor(level: number): Float64Array {
    if (!this.costs[level]) {
      const missing = LEVELS.filter((l) => !this.costs[l.id]);
      const arrays = computeArcCostsMulti(
        this.graph,
        missing.map((l) => scaledPenalties(l.penalties, this.factors)),
        this.corrections,
        this.costOptions,
      );
      missing.forEach((l, i) => (this.costs[l.id] = arrays[i]!));
    }
    return this.costs[level]!;
  }

  /** Levels 0, chosen and 3 (deduplicated, in that order). */
  route(from: Point, to: Point, level: number, levels: number[] = [...new Set([0, level, 3])]): RouteResponse {
    const t0 = performance.now();
    const src = this.snap.nearest(from.lon, from.lat, SNAP_MAX_M);
    if (!src) return { ok: false, error: 'start-off-network' };
    const dst = this.snap.nearest(to.lon, to.lat, SNAP_MAX_M);
    if (!dst) return { ok: false, error: 'end-off-network' };
    const routes: LevelRoute[] = [];
    for (const l of levels) {
      const res = this.router.search(this.costsFor(l), src, dst);
      if (!res) return { ok: false, error: 'no-route' };
      routes.push({ level: LEVELS[l]!, route: assembleRoute(this.graph, res, this.corrections, this.speeds), deltaM: 0, deltaPct: 0 });
    }
    const base = routes.find((r) => r.level.id === 0)?.route.stats.distance ?? routes[0]!.route.stats.distance;
    for (const r of routes) {
      r.deltaM = r.route.stats.distance - base;
      r.deltaPct = base > 0 ? (100 * r.deltaM) / base : 0;
    }
    return { ok: true, routes, chosen: routes.findIndex((r) => r.level.id === level), from: src, to: dst, ms: performance.now() - t0 };
  }
}
