/**
 * Route display (SPEC §9.1): the selected alternative coloured per segment (smooth neutral, SLABS
 * orange, PAVE red, rails with a purple edge, pushing dotted), the other alternatives as thin lines.
 */
import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { RouteView } from '../../worker/protocol.ts';
import type { Scheme } from '../useColorScheme.ts';

export const ROUTE_SOURCE = 'liscio-route';
export const ALT_HIT_LAYER = 'lr-alt-hit';
const PREFIX = 'lr-';

const COLORS = {
  light: { neutral: '#2b5f8a', casing: '#ffffff', alt: '#8a97a3' },
  dark: { neutral: '#9cc9f0', casing: '#0d1311', alt: '#7d8b96' },
};
const PAVE = '#d6336c';
const SLABS = '#f08c00';
const RAIL = '#8b5cf6';

export interface RoutePoints {
  from: [number, number] | null;
  to: [number, number] | null;
}

export function routeData(routes: RouteView[] | null, selected: number, points: RoutePoints): FeatureCollection {
  const features: FeatureCollection['features'] = [];
  // Selected level in colour; levels 0 and 3 as thin comparison lines (SPEC §9.1).
  for (const r of routes ?? []) {
    if (r.level !== selected && r.level !== 0 && r.level !== 3) continue;
    if (r.level === selected) {
      for (const s of r.segments) {
        features.push({ type: 'Feature', properties: { role: 'main', cls: s.cls, push: s.push ? 1 : 0, rail: s.rail ? 1 : 0 }, geometry: { type: 'LineString', coordinates: s.coords } });
      }
    } else {
      const coords = r.segments.flatMap((s, i) => (i === 0 ? s.coords : s.coords.slice(1)));
      features.push({ type: 'Feature', properties: { role: 'alt', level: r.level }, geometry: { type: 'LineString', coordinates: coords } });
    }
  }
  for (const [role, p] of Object.entries(points)) {
    if (p) features.push({ type: 'Feature', properties: { role }, geometry: { type: 'Point', coordinates: p } });
  }
  return { type: 'FeatureCollection', features };
}

export function addRouteLayers(map: MapLibreMap, scheme: Scheme) {
  const c = COLORS[scheme];
  if (!map.getSource(ROUTE_SOURCE)) map.addSource(ROUTE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const role = (r: string) => ['==', ['get', 'role'], r] as ['==', ['get', string], string];
  const width = (b: number) => ['interpolate', ['linear'], ['zoom'], 11, b * 0.55, 15, b, 18, b * 1.8] as unknown as number;
  const clsColor = ['match', ['get', 'cls'], 2, PAVE, 1, SLABS, c.neutral] as unknown as string;
  const layers: Parameters<MapLibreMap['addLayer']>[0][] = [
    { id: ALT_HIT_LAYER, type: 'line', source: ROUTE_SOURCE, filter: role('alt'), paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 22 } },
    { id: 'lr-alt', type: 'line', source: ROUTE_SOURCE, filter: role('alt'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.alt, 'line-width': width(3), 'line-opacity': 0.85 } },
    { id: 'lr-rail', type: 'line', source: ROUTE_SOURCE, filter: ['all', role('main'), ['==', ['get', 'rail'], 1]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': RAIL, 'line-width': width(12) } },
    { id: 'lr-casing', type: 'line', source: ROUTE_SOURCE, filter: role('main'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.casing, 'line-width': width(8) } },
    { id: 'lr-main', type: 'line', source: ROUTE_SOURCE, filter: ['all', role('main'), ['==', ['get', 'push'], 0]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': clsColor, 'line-width': width(5) } },
    { id: 'lr-push', type: 'line', source: ROUTE_SOURCE, filter: ['all', role('main'), ['==', ['get', 'push'], 1]], paint: { 'line-color': clsColor, 'line-width': width(5), 'line-dasharray': [0.4, 1.6] } },
    { id: 'lr-ends', type: 'circle', source: ROUTE_SOURCE, filter: ['any', role('from'), role('to')], paint: { 'circle-radius': 8, 'circle-color': ['match', ['get', 'role'], 'from', '#2f9e44', c.neutral] as unknown as string, 'circle-stroke-color': c.casing, 'circle-stroke-width': 3 } },
  ];
  for (const l of layers) if (!map.getLayer(l.id)) map.addLayer(l);
}

/** Keeps our sources (liscio-*) and layers (lr-*, ls-*) when the basemap style is swapped (light/dark). */
export function keepRouteLayers(prev: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification {
  if (!prev) return next;
  const ours = Object.fromEntries(Object.entries(prev.sources).filter(([id]) => id.startsWith('liscio-')));
  return {
    ...next,
    sources: { ...next.sources, ...ours },
    layers: [...next.layers, ...prev.layers.filter((l) => l.id.startsWith(PREFIX) || l.id.startsWith('ls-'))],
  };
}

export function setRouteData(map: MapLibreMap, data: FeatureCollection) {
  (map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined)?.setData(data);
}
