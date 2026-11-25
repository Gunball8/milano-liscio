/**
 * Position marker: a blue arrow turned to where the phone points (compass), or to the course while
 * riding; a dot with a halo when no direction is known.
 */
import type { GeoJSONSource, MapLibreMap } from 'maplibre-gl';

export const ME_SOURCE = 'liscio-me';
export const ME_LAYER = 'lr-me';
const BLUE = '#1a73e8';

function draw(kind: 'arrow' | 'dot'): ImageData {
  const size = 96; // drawn at 2x
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(26, 115, 232, 0.18)';
  g.beginPath();
  g.arc(48, 48, kind === 'arrow' ? 44 : 34, 0, Math.PI * 2);
  g.fill();
  g.lineJoin = 'round';
  g.lineWidth = 7;
  g.strokeStyle = '#ffffff';
  g.fillStyle = BLUE;
  g.beginPath();
  if (kind === 'arrow') {
    g.moveTo(48, 10);
    g.lineTo(76, 78);
    g.lineTo(48, 63);
    g.lineTo(20, 78);
    g.closePath();
  } else {
    g.arc(48, 48, 15, 0, Math.PI * 2);
  }
  g.stroke();
  g.fill();
  return g.getImageData(0, 0, size, size);
}

function ensureImages(map: MapLibreMap) {
  for (const kind of ['arrow', 'dot'] as const) {
    const id = `me-${kind}`;
    if (!map.hasImage(id)) map.addImage(id, draw(kind), { pixelRatio: 2 });
  }
}

export function addMeLayer(map: MapLibreMap) {
  ensureImages(map);
  // images belong to the style: add them again after a light/dark switch
  map.on('styleimagemissing', (e) => {
    if (e.id === 'me-arrow' || e.id === 'me-dot') ensureImages(map);
  });
  if (!map.getSource(ME_SOURCE)) map.addSource(ME_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  if (!map.getLayer(ME_LAYER)) {
    map.addLayer({
      id: ME_LAYER,
      type: 'symbol',
      source: ME_SOURCE,
      layout: {
        'icon-image': ['case', ['>=', ['get', 'heading'], 0], 'me-arrow', 'me-dot'],
        'icon-rotate': ['max', ['get', 'heading'], 0],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
  }
}

export function setMe(map: MapLibreMap, point: [number, number] | null, heading: number | null) {
  (map.getSource(ME_SOURCE) as GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection',
    features: point ? [{ type: 'Feature', properties: { heading: heading ?? -1 }, geometry: { type: 'Point', coordinates: point } }] : [],
  });
}
