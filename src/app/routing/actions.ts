/** Routing actions: worker start-up, endpoints, level, route computation, favourites, long-press menu. */
import { addFavorite, getSetting, listFavorites, pushRecent, removeFavorite, setSetting } from '../../storage/idb.ts';
import { GeoError, getPosition } from '../geo.ts';
import { type Endpoint, MY_POSITION, useApp } from '../store.ts';
import { call } from './client.ts';
import { syncWorker } from './sync.ts';

const set = useApp.setState;
const get = useApp.getState;

const ROUTE_ERRORS: Record<string, string> = {
  'start-off-network': "Départ à plus de 100 m d'une rue praticable à vélo.",
  'end-off-network': "Arrivée à plus de 100 m d'une rue praticable à vélo.",
  'no-route': 'Aucun itinéraire trouvé entre ces deux points.',
};

export async function initEngine(version: string) {
  set({ engine: 'loading' });
  try {
    const info = await call({ type: 'init', version });
    console.info(`routing worker ready in ${info.ms} ms (${info.nodes} nodes, ${info.places} places)`);
    set({ engine: 'ready' });
    await syncWorker(); // settings and corrections before the first route
    if (get().to) void computeRoute();
  } catch (err) {
    console.error(err);
    set({ engine: 'error', routeError: "Le calcul d'itinéraire n'a pas pu démarrer." });
  }
}

export async function loadPreferences() {
  const [favorites, level] = await Promise.all([listFavorites().catch(() => []), getSetting<number>('level', 2)]);
  set({ favorites, level, selected: level });
}

let routeSeq = 0;

/** Computes levels 0, chosen and 3 (SPEC §7). Stale answers are dropped. */
export async function computeRoute() {
  const { from, to, level, engine } = get();
  if (!to) {
    set({ routes: null, routeStatus: 'idle', routeError: null });
    return;
  }
  if (engine !== 'ready') return; // initEngine calls back when ready
  const seq = ++routeSeq;
  try {
    const resolve = async (e: Endpoint) => {
      if (e.kind === 'place') return { lon: e.lon!, lat: e.lat! };
      set({ routeStatus: 'locating', routeError: null });
      const fix = await getPosition();
      set({ position: fix });
      return { lon: fix.lon, lat: fix.lat };
    };
    const a = await resolve(from);
    const b = await resolve(to);
    if (seq !== routeSeq) return;
    set({ routeStatus: 'computing', routeError: null });
    const res = await call({ type: 'route', from: a, to: b, level });
    if (seq !== routeSeq) return;
    if (!res.ok) {
      set({ routes: null, routeStatus: 'error', routeError: ROUTE_ERRORS[res.error] ?? res.error });
      return;
    }
    set({ routes: res.result.routes, selected: level, routeStatus: 'done', routeError: null });
  } catch (err) {
    if (seq !== routeSeq) return;
    set({ routes: null, routeStatus: 'error', routeError: err instanceof GeoError ? err.message : `Erreur : ${err instanceof Error ? err.message : String(err)}` });
  }
}

export function setEndpoint(field: 'from' | 'to', e: Endpoint) {
  set({ [field]: e, searchField: null, menu: null } as Partial<ReturnType<typeof get>>);
  if (e.kind === 'place' && e.lon !== undefined && e.lat !== undefined) {
    void pushRecent({ label: e.label, sublabel: e.sublabel ?? '', lon: e.lon, lat: e.lat }).catch(() => undefined);
  }
  void computeRoute();
}

export function swapEndpoints() {
  const { from, to } = get();
  if (!to) return;
  set({ from: to, to: from });
  void computeRoute();
}

export function clearRoute() {
  routeSeq++;
  set({ to: null, from: MY_POSITION, routes: null, routeStatus: 'idle', routeError: null });
}

export function setLevel(level: number) {
  set({ level, selected: level });
  void setSetting('level', level).catch(() => undefined);
  void computeRoute();
}

export function selectAlternative(level: number) {
  set({ selected: level });
}

export async function saveFavorite(name: string, lon: number, lat: number) {
  await addFavorite(name, lon, lat);
  set({ favorites: await listFavorites(), menu: null });
}

export async function deleteFavorite(id: string) {
  await removeFavorite(id);
  set({ favorites: await listFavorites() });
}

/** Long press on the map: open the menu, then fill in the nearest street name. */
export async function openMenu(lon: number, lat: number, x: number, y: number) {
  set({ menu: { lon, lat, x, y, street: null } });
  if (get().engine !== 'ready') return;
  try {
    const d = await call({ type: 'describe', point: { lon, lat } });
    const m = get().menu;
    if (m && m.lon === lon && m.lat === lat) set({ menu: { ...m, street: d?.street ?? null } });
  } catch {
    /* name is optional */
  }
}

export function pointEndpoint(lon: number, lat: number, street: string | null): Endpoint {
  return { kind: 'place', label: street ? `Près de ${street}` : 'Point sur la carte', sublabel: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lon, lat };
}
