/**
 * Basemap style (SPEC §5.4): Protomaps layers in Italian, glyphs and sprites served locally so labels
 * render offline, tiles read from the cached PMTiles file through the pmtiles:// protocol.
 */
import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';
import type { Scheme } from '../useColorScheme.ts';

export const PMTILES_NAME = 'milano.pmtiles';

export function buildStyle(scheme: Scheme): StyleSpecification {
  // MapLibre needs absolute URLs for glyphs and sprites; keep the {tokens} unencoded.
  const base = `${location.origin}${import.meta.env.BASE_URL}`;
  return {
    version: 8,
    glyphs: `${base}fonts/{fontstack}/{range}.pbf`,
    sprite: `${base}sprites/v4/${scheme}`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${PMTILES_NAME}`,
        attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: layers('protomaps', namedFlavor(scheme), { lang: 'it' }),
  };
}
