/**
 * "Revêtements" layer and selection (SPEC §9.3): PAVE red, SLABS orange, rails purple, UNKNOWN grey
 * dashed, corrected edges with a white dotted line, selected edge or street highlighted, reports.
 */
import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, MapLibreMap } from 'maplibre-gl';

export const SURFACE_SOURCE = 'liscio-surface';
export const SELECTION_SOURCE = 'liscio-selection';
export const REPORTS_SOURCE = 'liscio-reports';
export const SURFACE_LAYERS = ['ls-rail', 'ls-unknown', 'ls-slabs', 'ls-pave', 'ls-corrected'];
export const SURFACE_MIN_ZOOM = 13.5;

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

export function addCorrectionLayers(map: MapLibreMap) {
  for (const id of [SURFACE_SOURCE, SELECTION_SOURCE, REPORTS_SOURCE]) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  const before = map.getLayer('lr-alt-hit') ? 'lr-alt-hit' : undefined;
  const width = (b: number) => ['interpolate', ['linear'], ['zoom'], 13, b * 0.6, 16, b, 18, b * 1.6] as unknown as number;
  const cls = (c: number) => ['==', ['get', 'cls'], c] as ['==', ['get', string], number];
  const layers: Parameters<MapLibreMap['addLayer']>[0][] = [
    { id: 'ls-selection', type: 'line', source: SELECTION_SOURCE, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fcc419', 'line-width': width(16), 'line-opacity': 0.85 } },
    { id: 'ls-rail', type: 'line', source: SURFACE_SOURCE, filter: ['==', ['get', 'rail'], 1], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#8b5cf6', 'line-width': width(9) } },
    { id: 'ls-unknown', type: 'line', source: SURFACE_SOURCE, filter: cls(4), paint: { 'line-color': '#868e96', 'line-width': width(3), 'line-dasharray': [2, 1.5] } },
    { id: 'ls-slabs', type: 'line', source: SURFACE_SOURCE, filter: cls(1), layout: { 'line-cap': 'round' }, paint: { 'line-color': '#f08c00', 'line-width': width(4) } },
    { id: 'ls-pave', type: 'line', source: SURFACE_SOURCE, filter: cls(2), layout: { 'line-cap': 'round' }, paint: { 'line-color': '#d6336c', 'line-width': width(4) } },
    { id: 'ls-corrected', type: 'line', source: SURFACE_SOURCE, filter: ['==', ['get', 'corrected'], 1], paint: { 'line-color': '#ffffff', 'line-width': width(1.6), 'line-dasharray': [0.6, 1.4] } },
    { id: 'ls-reports', type: 'circle', source: REPORTS_SOURCE, paint: { 'circle-radius': 8, 'circle-color': '#d6336c', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } },
  ];
  for (const l of layers) if (!map.getLayer(l.id)) map.addLayer(l, l.id === 'ls-reports' ? undefined : before);
}

export function setData(map: MapLibreMap, source: string, data: FeatureCollection) {
  (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}

export { EMPTY };
