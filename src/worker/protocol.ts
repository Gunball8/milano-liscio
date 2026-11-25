/** Messages between the UI and the routing worker. */
import type { CorrectionRecord, CorrectionStatus, EdgeState, SurfaceFeature } from '../core/corrections.ts';
import { DEFAULT_FACTORS, type PenaltyFactors } from '../core/cost.ts';
import type { GeoResult } from '../core/geocode.ts';
import type { RouteError } from '../core/engine.ts';
import type { RouteStats } from '../core/route.ts';

export interface LngLatPoint {
  lon: number;
  lat: number;
}

export interface SegmentView {
  coords: [number, number][];
  cls: number;
  push: boolean;
  rail: boolean;
  /** Against a oneway. */
  contra: boolean;
  /** Meters, for the route ribbon. */
  length: number;
}

export interface RouteView {
  level: 0 | 1 | 2 | 3;
  label: string;
  stats: RouteStats;
  deltaM: number;
  deltaPct: number;
  segments: SegmentView[];
}

export interface RouteResult {
  routes: RouteView[];
  /** Points actually used, after snapping to the network. */
  from: LngLatPoint & { dist: number };
  to: LngLatPoint & { dist: number };
  ms: number;
}

/** Settings (SPEC §9.4) that change routing. */
export interface Prefs {
  /** Average riding speed, km/h. */
  speed: number;
  factors: PenaltyFactors;
}

export const DEFAULT_PREFS: Prefs = { speed: 15, factors: DEFAULT_FACTORS };

/** A graph edge as shown in the segment sheet (SPEC §9.3). */
export interface EdgeInfo {
  edge: number;
  wayId: number;
  name: string | null;
  length: number;
  /** Last OSM modification (YYYY-MM-DD), null when unknown. */
  osmDate: string | null;
  mid: [number, number];
  coords: [number, number][];
  osm: EdgeState;
  effective: EdgeState & { corrected: boolean };
}

export type Request =
  | { type: 'init'; version: string }
  | { type: 'search'; query: string; limit?: number }
  | { type: 'route'; from: LngLatPoint; to: LngLatPoint; level: number; /** default: 0, level, 3 */ levels?: number[] }
  | { type: 'describe'; point: LngLatPoint }
  | { type: 'setOptions'; prefs: Prefs }
  | { type: 'setCorrections'; corrections: CorrectionRecord[] }
  | { type: 'surface'; bbox: [number, number, number, number] }
  | { type: 'edgeAt'; point: LngLatPoint }
  | { type: 'edgeInfo'; edge: number }
  | { type: 'street'; edge: number }
  | { type: 'tags'; edge: number }
  | { type: 'geometryOf'; corrections: CorrectionRecord[] };

export interface InitInfo {
  ms: number;
  nodes: number;
  places: number;
}

export type ResponseFor<R extends Request> = R extends { type: 'init' }
  ? InitInfo
  : R extends { type: 'search' }
    ? GeoResult[]
    : R extends { type: 'route' }
      ? { ok: true; result: RouteResult } | { ok: false; error: RouteError }
      : R extends { type: 'describe' }
        ? { street: string | null; dist: number } | null
        : R extends { type: 'setOptions' }
          ? true
          : R extends { type: 'setCorrections' }
            ? CorrectionStatus[]
            : R extends { type: 'surface' }
              ? { features: SurfaceFeature[]; truncated: boolean }
              : R extends { type: 'edgeAt' }
                ? EdgeInfo | null
                : R extends { type: 'edgeInfo' }
                  ? EdgeInfo
                  : R extends { type: 'street' }
                    ? EdgeInfo[]
                    : R extends { type: 'tags' }
                      ? [string, string][]
                      : R extends { type: 'geometryOf' }
                        ? ([number, number][] | null)[]
                        : never;

export type WorkerMessage = { id: number } & Request;
export type WorkerReply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
