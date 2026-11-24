/** Launch sequence (SPEC §9.4): install hint, first download, persistent storage, update checks. */
import { downloadVersion, fetchRemoteManifest, installedManifest, requestPersistence, type DataManifest } from '../storage/dataCache.ts';
import { useApp } from './store.ts';

const CONTINUE_KEY = 'liscio.continueInBrowser';
const set = useApp.setState;

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function sessionFlag(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export async function boot() {
  const standalone = isStandalone();
  set({ standalone, ios: isIos() });
  const installed = await installedManifest().catch(() => null);
  if (installed) {
    set({ installed, phase: 'ready' });
    void checkForUpdate();
    return;
  }
  if (!standalone && !sessionFlag(CONTINUE_KEY)) {
    set({ phase: 'install' });
    return;
  }
  await offerDownload();
}

export function continueInBrowser() {
  try {
    sessionStorage.setItem(CONTINUE_KEY, '1');
  } catch {
    /* private mode: just continue */
  }
  void offerDownload();
}

export async function offerDownload() {
  set({ phase: 'offer', error: null, remote: undefined });
  const remote = await fetchRemoteManifest();
  set({ remote, phase: remote ? 'offer' : 'error', error: remote ? null : 'offline' });
}

export async function startFirstDownload(m: DataManifest) {
  set({ phase: 'downloading', progress: { loaded: 0, total: 0, file: '' }, error: null });
  try {
    await downloadVersion(m, (progress) => set({ progress }));
    await requestPersistence();
    set({ installed: await installedManifest(), phase: 'ready', progress: null });
  } catch (err) {
    set({ phase: 'error', error: err instanceof Error ? err.message : String(err), progress: null });
  }
}

export async function checkForUpdate() {
  set({ remote: undefined });
  set({ remote: await fetchRemoteManifest() });
}

/** Downloads a newer version in the background; the current map stays usable until it completes. */
export async function startUpdate() {
  const { remote } = useApp.getState();
  if (!remote) return;
  set({ updating: true, progress: { loaded: 0, total: 0, file: '' }, error: null });
  try {
    await downloadVersion(remote, (progress) => set({ progress }));
    set((s) => ({ installed: remote, updating: false, progress: null, mapKey: s.mapKey + 1 }));
  } catch (err) {
    set({ updating: false, progress: null, error: err instanceof Error ? err.message : String(err) });
  }
}
