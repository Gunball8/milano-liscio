import { create } from 'zustand';
import type { DataManifest, Progress } from '../storage/dataCache.ts';

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
}));

// Exposed for end-to-end tests and debugging from the console.
(globalThis as unknown as { __liscio: typeof useApp }).__liscio = useApp;
