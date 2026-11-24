/** Corrections screen (SPEC §9.3), reports to sort, backup, and settings (SPEC §9.4). */
import type { CorrectedSurface, CorrectionRecord } from '../../core/corrections.ts';
import {
  type Report,
  deleteCorrections,
  deleteReport as dbDeleteReport,
  getSetting,
  listCorrections,
  listFavorites,
  listReports,
  newId,
  putCorrections,
  putFavorites,
  putReports,
  setSetting,
  updateReport,
} from '../../storage/idb.ts';
import { DEFAULT_PREFS, type EdgeInfo, type Prefs } from '../../worker/protocol.ts';
import { saveFile, today } from '../files.ts';
import { computeRoute } from '../routing/actions.ts';
import { call } from '../routing/client.ts';
import { syncWorker } from '../routing/sync.ts';
import { useApp } from '../store.ts';

const set = useApp.setState;
const get = useApp.getState;

function toast(message: string) {
  set({ toast: message });
  setTimeout(() => {
    if (get().toast === message) set({ toast: null });
  }, 2500);
}

// ---------- loading ----------

export async function loadCorrectionData() {
  const [corrections, reports, prefs] = await Promise.all([
    listCorrections().catch(() => []),
    listReports().catch(() => []),
    getSetting<Prefs>('prefs', DEFAULT_PREFS),
  ]);
  set({ corrections, reports, prefs: { ...DEFAULT_PREFS, ...prefs, factors: { ...DEFAULT_PREFS.factors, ...prefs.factors } } });
}

async function reloadCorrections() {
  set({ corrections: await listCorrections() });
  await syncWorker();
}

// ---------- mode ----------

export function enterCorrections() {
  set({ mode: 'corrections', sheet: 'none', menu: null, searchField: null, selectedEdge: null, street: null, wholeStreet: false });
}

export function exitCorrections() {
  set({ mode: 'map', selectedEdge: null, street: null, wholeStreet: false, focusReport: null, sheet: 'none' });
  // corrections count from the next calculation (SPEC §9.3)
  if (get().to) void computeRoute();
}

export async function selectEdgeAt(lon: number, lat: number) {
  const info = await call({ type: 'edgeAt', point: { lon, lat } });
  set({ selectedEdge: info, street: null, wholeStreet: false });
  if (!info) toast('Aucune rue praticable à vélo ici.');
}

/** The switch reflects the tap at once; the street's edges arrive from the worker just after. */
export async function setWholeStreet(on: boolean) {
  const e = get().selectedEdge;
  if (!e) return;
  set({ wholeStreet: on, street: null });
  if (!on) return;
  const street = await call({ type: 'street', edge: e.edge });
  if (get().wholeStreet && get().selectedEdge?.edge === e.edge) set({ street });
}

async function targets(): Promise<EdgeInfo[]> {
  const { selectedEdge, wholeStreet, street } = get();
  if (!selectedEdge) return [];
  if (!wholeStreet) return [selectedEdge];
  return street ?? (await call({ type: 'street', edge: selectedEdge.edge }));
}

async function refreshSelection() {
  const { selectedEdge, street } = get();
  if (!selectedEdge) return;
  set({
    selectedEdge: await call({ type: 'edgeInfo', edge: selectedEdge.edge }),
    street: street ? await call({ type: 'street', edge: selectedEdge.edge }) : null,
  });
}

/** Records attached to an edge (according to the last resolution by the worker). */
function recordsOn(edge: number): CorrectionRecord[] {
  const { corrections, correctionStatus } = get();
  return corrections.filter((c) => correctionStatus[c.id]?.edge === edge);
}

/** Lisse / Dalles / Pavé, Rails oui / non on the selected edge or the whole street. */
export async function applyCorrection(patch: { surface?: CorrectedSurface; rails?: boolean }) {
  const report = get().focusReport;
  const now = Date.now();
  const records: CorrectionRecord[] = (await targets()).map((t, i) => {
    const existing = recordsOn(t.edge).at(-1);
    if (existing) return { ...existing, ...patch, createdAt: now + i };
    return {
      id: newId(),
      wayId: t.wayId,
      mid: t.mid,
      length: Math.round(t.length),
      name: t.name,
      ...patch,
      source: report ? 'report' : 'manual',
      createdAt: now + i,
    };
  });
  await putCorrections(records);
  await reloadCorrections();
  await refreshSelection();
  toast(records.length > 1 ? `${records.length} tronçons corrigés` : 'Tronçon corrigé');
}

/** "Rétablir OSM": drop the corrections of the selected edge or street. */
export async function restoreOsm() {
  const ids = (await targets()).flatMap((t) => recordsOn(t.edge).map((c) => c.id));
  if (ids.length === 0) return;
  await deleteCorrections(ids);
  await reloadCorrections();
  await refreshSelection();
  toast('Données OSM rétablies');
}

export async function removeCorrections(ids: string[]) {
  await deleteCorrections(ids);
  await reloadCorrections();
}

export async function focusCorrection(c: CorrectionRecord) {
  set({ sheet: 'none' });
  const st = get().correctionStatus[c.id];
  if (st && st.edge >= 0) set({ selectedEdge: await call({ type: 'edgeInfo', edge: st.edge }), street: null, wholeStreet: false });
}

// ---------- reports to sort ----------

export async function loadReports() {
  set({ reports: await listReports() });
}

/** Tapping a report centres the map on it in correction mode (SPEC §9.3). */
export async function focusReport(r: Report) {
  set({ mode: 'corrections', sheet: 'none', focusReport: r, street: null, wholeStreet: false });
  await selectEdgeAt(r.lon, r.lat);
}

export async function markReportDone(r: Report) {
  await updateReport({ ...r, status: 'done' });
  if (get().focusReport?.id === r.id) set({ focusReport: null });
  await loadReports();
}

export async function deleteReport(id: string) {
  await dbDeleteReport(id);
  await loadReports();
}

// ---------- backup ----------

interface Backup {
  app: 'milano-liscio';
  kind: 'backup';
  version: 1;
  exportedAt: string;
  dataVersion: string | null;
  corrections: CorrectionRecord[];
  reports: Report[];
  favorites: Awaited<ReturnType<typeof listFavorites>>;
}

export async function exportBackup() {
  const backup: Backup = {
    app: 'milano-liscio',
    kind: 'backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    dataVersion: get().installed?.version ?? null,
    corrections: await listCorrections(),
    reports: await listReports(),
    favorites: await listFavorites(),
  };
  await saveFile(`milano-liscio-sauvegarde-${today()}.json`, 'application/json', JSON.stringify(backup, null, 2));
}

/** Restores a backup: records are merged by id, nothing is deleted. */
export async function importBackup(file: File) {
  let data: Partial<Backup>;
  try {
    data = JSON.parse(await file.text()) as Partial<Backup>;
  } catch {
    toast("Ce fichier n'est pas une sauvegarde Milano Liscio.");
    return;
  }
  if (data.app !== 'milano-liscio' || data.kind !== 'backup' || !Array.isArray(data.corrections)) {
    toast("Ce fichier n'est pas une sauvegarde Milano Liscio.");
    return;
  }
  await putCorrections(data.corrections);
  if (Array.isArray(data.reports)) await putReports(data.reports);
  if (Array.isArray(data.favorites)) await putFavorites(data.favorites);
  set({ favorites: await listFavorites() });
  await loadReports();
  await reloadCorrections();
  toast(`${data.corrections.length} correction${data.corrections.length > 1 ? 's' : ''} importée${data.corrections.length > 1 ? 's' : ''}`);
}

const OSM_SURFACE: Record<CorrectedSurface, string> = { SMOOTH: 'asphalt', SLABS: 'paving_stones', PAVE: 'sett' };

/** GeoJSON for reporting the corrections to OSM by hand (SPEC §9.3). */
export async function exportGeojson() {
  const { corrections, correctionStatus } = get();
  const geoms = await call({ type: 'geometryOf', corrections });
  const features = corrections.map((c, i) => ({
    type: 'Feature',
    properties: {
      name: c.name,
      osm_way: `https://www.openstreetmap.org/way/${c.wayId}`,
      surface_constate: c.surface ?? null,
      surface_osm_suggere: c.surface ? OSM_SURFACE[c.surface] : null,
      rails: c.rails ?? null,
      note: c.note ?? null,
      etat: correctionStatus[c.id]?.state ?? 'orphan',
      date: new Date(c.createdAt).toISOString().slice(0, 10),
    },
    geometry: geoms[i] ? { type: 'LineString', coordinates: geoms[i] } : { type: 'Point', coordinates: c.mid },
  }));
  await saveFile(`milano-liscio-corrections-${today()}.geojson`, 'application/geo+json', JSON.stringify({ type: 'FeatureCollection', features }, null, 2));
}

// ---------- settings (SPEC §9.4) ----------

export async function savePrefs(patch: Partial<Prefs>) {
  const prefs = { ...get().prefs, ...patch, factors: { ...get().prefs.factors, ...patch.factors } };
  set({ prefs });
  await setSetting('prefs', prefs);
  await syncWorker();
  if (get().to && get().mode === 'map') void computeRoute();
}
