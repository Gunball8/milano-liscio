import { SURFACE_CLASSES } from '../../src/core/classify.ts';
import type { LevelRoute } from '../../src/core/engine.ts';

export const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
export const fmtMin = (s: number) => `${Math.round(s / 60)} min`;
export const fmtDelta = (r: LevelRoute) => (r.level.id === 0 ? '–' : `${r.deltaM >= 0 ? '+' : ''}${Math.round(r.deltaM)} m (${r.deltaPct >= 0 ? '+' : ''}${r.deltaPct.toFixed(1)} %)`);

export const ROUTE_HEADERS = ['Niveau', 'Distance', 'Écart vs Court', 'Durée', 'Pavé', 'Dalles', 'Le long de rails', 'Croisements obliques', 'Contresens'];

export function routeRow(r: LevelRoute): string[] {
  const s = r.route.stats;
  return [`${r.level.id} ${r.level.label}`, fmtM(s.distance), fmtDelta(r), fmtMin(s.duration), fmtM(s.paveM), fmtM(s.slabsM), fmtM(s.railM), String(s.crossings), fmtM(s.contraM)];
}

/** One feature per homogeneous segment, for geojson.io or the audit map. */
export function routesToGeoJSON(routes: LevelRoute[], extra: Record<string, unknown> = {}) {
  return {
    type: 'FeatureCollection',
    features: routes.flatMap((r) =>
      r.route.segments.map((seg) => ({
        type: 'Feature',
        properties: {
          ...extra,
          level: r.level.id,
          levelLabel: r.level.label,
          surface: SURFACE_CLASSES[seg.cls],
          push: seg.push,
          rail: seg.rail,
          length: Math.round(seg.length),
          stroke: seg.cls === 2 ? '#d6336c' : seg.cls === 1 ? '#f08c00' : seg.rail ? '#7048e8' : '#495057',
          'stroke-width': r.level.id === 0 ? 2 : r.level.id === 3 ? 3 : 5,
        },
        geometry: { type: 'LineString', coordinates: seg.coords },
      })),
    ),
  };
}
