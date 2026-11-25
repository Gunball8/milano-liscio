import { create } from 'zustand';
import type { DataManifest, Progress } from '../storage/dataCache.ts';
import type { CorrectionRecord, CorrectionStatus } from '../core/corrections.ts';
import type { LockState } from '../core/screenLock.ts';
import type { NextStretch } from '../core/tracking.ts';
import type { Favorite, Report } from '../storage/idb.ts';
import { DEFAULT_PREFS, type EdgeInfo, type Prefs, type RouteView } from '../worker/protocol.ts';

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
  /** Course over ground when known (moving), for the position arrow. */
  course: number | null;
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
  sheet: 'none' | 'data' | 'menu' | 'settings' | 'list';
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
  mode: 'map' | 'tracking' | 'corrections';
  tracking: TrackingState | null;

  // ---- corrections and settings (phase 5)
  prefs: Prefs;
  corrections: CorrectionRecord[];
  correctionStatus: Record<string, CorrectionStatus>;
  reports: Report[];
  /** "Revêtements" layer shown outside the Corrections screen. */
  surfaceLayer: boolean;
  /** Bumped when the surface layer must be redrawn (corrections changed). */
  surfaceKey: number;
  selectedEdge: EdgeInfo | null;
  /** "Appliquer à toute la rue" switch, set immediately on tap. */
  wholeStreet: boolean;
  /** The contiguous edges of the same street once loaded, else null. */
  street: EdgeInfo[] | null;
  focusReport: Report | null;
  toast: string | null;
  /** Zoomed in enough for the surface layer. */
  surfaceZoomOk: boolean;

  // ---- design refresh
  /** Where the phone points (degrees from north), null without compass. */
  compass: number | null;
  /** One-off camera request (locate button); nonce makes repeated taps count. */
  flyTo: { lon: number; lat: number; zoom: number; nonce: number } | null;
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
  prefs: DEFAULT_PREFS,
  corrections: [],
  correctionStatus: {},
  reports: [],
  surfaceLayer: false,
  surfaceKey: 0,
  selectedEdge: null,
  wholeStreet: false,
  street: null,
  focusReport: null,
  toast: null,
  surfaceZoomOk: true,
  compass: null,
  flyTo: null,
}));

// Exposed for end-to-end tests and debugging from the console.
(globalThis as unknown as { __liscio: typeof useApp }).__liscio = useApp;
