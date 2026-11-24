/** Messages between the UI and the routing worker. */
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

export type Request =
  | { type: 'init'; version: string }
  | { type: 'search'; query: string; limit?: number }
  | { type: 'route'; from: LngLatPoint; to: LngLatPoint; level: number }
  | { type: 'describe'; point: LngLatPoint };

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
        : never;

export type WorkerMessage = { id: number } & Request;
export type WorkerReply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
