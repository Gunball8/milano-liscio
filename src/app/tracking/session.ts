/**
 * Live guidance session (SPEC §9.2): high-accuracy GPS watch, wake lock, progress, off-route
 * recalculation from the current position at the same level, arrival, reports, resume after the app
 * comes back to the foreground.
 */
import { type WakeLockLike, ScreenLock } from '../../core/screenLock.ts';
import { ARRIVAL_M, GOOD_ACCURACY_M, OffRouteDetector, ROTATE_ABOVE_MPS, RouteTracker, courseFrom } from '../../core/tracking.ts';
import { addReport, listReports } from '../../storage/idb.ts';
import { startCompass } from '../compass.ts';
import { call } from '../routing/client.ts';
import { type TrackingState, useApp } from '../store.ts';

const set = useApp.setState;
const get = useApp.getState;

let tracker: RouteTracker | null = null;
const detector = new OffRouteDetector();
let watchId: number | null = null;
let lastFix: { lon: number; lat: number; t: number } | null = null;
let lock: ScreenLock | null = null;
let recalculating = false;

function patch(p: Partial<TrackingState>) {
  const t = get().tracking;
  if (t) set({ tracking: { ...t, ...p } });
}

function progressPatch(): Partial<TrackingState> {
  if (!tracker) return {};
  const remainingS = tracker.remainingS();
  return { remainingM: tracker.remainingM(), remainingS, etaMs: Date.now() + remainingS * 1000, next: tracker.nextDegraded() };
}

function onVisibility() {
  if (document.visibilityState !== 'visible' || get().mode !== 'tracking' || get().tracking?.arrived) return;
  void lock?.onVisible();
  startWatch(); // iOS may have suspended the watch while locked
}

function startWatch() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(onFix, onGeoError, { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 });
}

function stopWatch() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function onGeoError(err: GeolocationPositionError) {
  if (err.code === err.PERMISSION_DENIED) patch({ error: 'Localisation refusée : le suivi ne peut pas fonctionner.' });
  // timeouts are transient: the watch keeps running
}

function onFix(p: GeolocationPosition) {
  if (!tracker || get().mode !== 'tracking') return;
  // Our own reception time: position timestamps are not reliable everywhere (microseconds in some engines).
  const fix = { lon: p.coords.longitude, lat: p.coords.latitude, t: Date.now() };
  const accuracy = p.coords.accuracy;
  const course = courseFrom(lastFix, fix, { heading: p.coords.heading, speed: p.coords.speed });
  lastFix = fix;

  const loc = tracker.locate(fix.lon, fix.lat);
  const t = get().tracking;
  if (!t) return;
  const bearing = course.heading !== null && course.speed !== null && course.speed > ROTATE_ABOVE_MPS ? course.heading : t.bearing;
  // One update for position and course, so the map never follows a position with the previous bearing.
  set({
    position: { lon: fix.lon, lat: fix.lat, accuracy },
    tracking: {
      ...t,
      ...progressPatch(),
      offset: loc.offset,
      accuracy,
      imprecise: accuracy >= GOOD_ACCURACY_M,
      bearing,
      course: course.heading !== null && course.speed !== null && course.speed > ROTATE_ABOVE_MPS ? course.heading : t.course,
      error: null,
    },
  });

  if (tracker.distanceToEnd(fix.lon, fix.lat) < ARRIVAL_M) {
    arrive();
    return;
  }
  if (!recalculating && detector.push(loc.offset, accuracy)) void recalculate(fix);
}

async function recalculate(from: { lon: number; lat: number }) {
  const { to, selected } = get();
  if (!to || to.lon === undefined || to.lat === undefined) return;
  recalculating = true;
  patch({ recalculating: true });
  try {
    const res = await call({ type: 'route', from, to: { lon: to.lon, lat: to.lat }, level: selected, levels: [selected] });
    if (get().mode !== 'tracking') return;
    if (!res.ok) {
      patch({ error: res.error === 'start-off-network' ? 'Hors du réseau cyclable : recalcul impossible ici.' : 'Recalcul impossible.' });
      return;
    }
    const route = res.result.routes.find((r) => r.level === selected) ?? res.result.routes[0]!;
    tracker = new RouteTracker(route.segments, { ride: get().prefs.speed, push: 4.5 });
    detector.reset();
    set({ routes: [route], selected: route.level });
    patch({ ...progressPatch(), recalcs: (get().tracking?.recalcs ?? 0) + 1, error: null });
  } catch (err) {
    patch({ error: `Recalcul impossible : ${err instanceof Error ? err.message : String(err)}` });
  } finally {
    recalculating = false;
    patch({ recalculating: false });
  }
}

function arrive() {
  stopWatch();
  void lock?.disable();
  patch({ arrived: true, remainingM: 0, remainingS: 0, next: null });
}

export async function startTracking() {
  void startCompass(); // inside the "Démarrer" tap, for the iOS permission prompt
  const s = get();
  const route = s.routes?.find((r) => r.level === s.selected);
  if (!route) return;
  tracker = new RouteTracker(route.segments, { ride: s.prefs.speed, push: 4.5 });
  detector.reset();
  lastFix = null;
  recalculating = false;
  set({
    mode: 'tracking',
    routes: [route],
    searchField: null,
    menu: null,
    sheet: 'none',
    tracking: {
      ...{ remainingM: tracker.length, remainingS: tracker.remainingS(0), etaMs: Date.now() + tracker.remainingS(0) * 1000, next: tracker.nextDegraded(0) },
      offset: 0,
      accuracy: null,
      imprecise: false,
      recalculating: false,
      recalcs: 0,
      arrived: false,
      lock: 'off',
      following: true,
      bearing: 0,
      course: null,
      reports: 0,
      error: null,
    },
  });
  // Requested inside the "Démarrer" tap: the wake lock needs a user gesture.
  lock = new ScreenLock((navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock, (state) => patch({ lock: state }));
  void lock.enable();
  document.addEventListener('visibilitychange', onVisibility);
  startWatch();
  patch({ reports: (await listReports().catch(() => [])).filter((r) => r.status === 'todo').length });
}

export async function stopTracking() {
  stopWatch();
  document.removeEventListener('visibilitychange', onVisibility);
  await lock?.disable();
  lock = null;
  tracker = null;
  set({ mode: 'map', tracking: null });
}

/** Big "Signaler" button: position, heading and time go to the list to sort. No typing while riding. */
export async function report() {
  const { position, tracking } = get();
  if (!position) {
    patch({ error: 'Pas encore de position GPS à enregistrer.' });
    return;
  }
  await addReport({ lon: position.lon, lat: position.lat, heading: tracking?.bearing ?? null, accuracy: position.accuracy, at: Date.now() });
  patch({ reports: (get().tracking?.reports ?? 0) + 1 });
}

export function setFollowing(following: boolean) {
  patch({ following });
}
