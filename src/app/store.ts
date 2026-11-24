import { create } from 'zustand';
import type { DataManifest, Progress } from '../storage/dataCache.ts';
import type { LockState } from '../core/screenLock.ts';
import type { NextStretch } from '../core/tracking.ts';
import type { Favorite } from '../storage/idb.ts';
import type { RouteView } from '../worker/protocol.ts';

/** Departure or arrival. "position" is resolved with the GPS when a route is computed. */
export interface Endpoint {
  kind: 'position' | 'place';
  label: string;
  sublabel?: string;
  lon?: number;
  lat?: number;
  approximate?: boolean;
}

export const MY_POSITION: Endpoint = { kind: 'position', label: 'Ma position' };

/** Live guidance state (SPEC §9.2). */
export interface TrackingState {
  remainingM: number;
  remainingS: number;
  etaMs: number;
  next: NextStretch | null;
  offset: number;
  accuracy: number | null;
  /** Last fix less precise than 30 m: shown, no off-route decision. */
  imprecise: boolean;
  recalculating: boolean;
  recalcs: number;
  arrived: boolean;
  lock: LockState;
  /** Map follows the position (off after the user pans). */
  following: boolean;
  /** Map bearing, from the course when faster than 2 m/s. */
  bearing: number;
  reports: number;
  error: string | null;
}

export type Phase = 'boot' | 'install' | 'offer' | 'downloading' | 'ready' | 'error';

export interface AppState {
  phase: Phase;
  /** Launched from the home screen icon. */
  standalone: boolean;
  ios: boolean;
  installed: DataManifest | null;
  /** undefined: not checked yet; null: network unreachable. */
  remote: DataManifest | null | undefined;
  progress: Progress | null;
  error: string | null;
  /** An update download is running while the map stays usable. */
  updating: boolean;
  sheet: 'none' | 'data';
  /** Bumped when the map should be rebuilt on new data. */
  mapKey: number;

  // ---- routing (phase 3)
  engine: 'off' | 'loading' | 'ready' | 'error';
  from: Endpoint;
  to: Endpoint | null;
  /** Level chosen with the 4-step selector. */
  level: number;
  routes: RouteView[] | null;
  /** Level of the alternative shown in colour (tapping an alternative selects it). */
  selected: number;
  routeStatus: 'idle' | 'locating' | 'computing' | 'done' | 'error';
  routeError: string | null;
  searchField: 'from' | 'to' | null;
  favorites: Favorite[];
  position: { lon: number; lat: number; accuracy: number } | null;
  menu: { lon: number; lat: number; x: number; y: number; street: string | null } | null;

  // ---- tracking (phase 4)
  mode: 'map' | 'tracking';
  tracking: TrackingState | null;
}

export const useApp = create<AppState>(() => ({
  phase: 'boot',
  standalone: false,
  ios: false,
  installed: null,
  remote: undefined,
  progress: null,
  error: null,
  updating: false,
  sheet: 'none',
  mapKey: 0,
  engine: 'off',
  from: MY_POSITION,
  to: null,
  level: 2,
  routes: null,
  selected: 2,
  routeStatus: 'idle',
  routeError: null,
  searchField: null,
  favorites: [],
  position: null,
  menu: null,
  mode: 'map',
  tracking: null,
}));

// Exposed for end-to-end tests and debugging from the console.
(globalThis as unknown as { __liscio: typeof useApp }).__liscio = useApp;
