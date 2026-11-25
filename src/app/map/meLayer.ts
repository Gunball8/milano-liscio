/**
 * Position marker: a DOM marker the map positions and turns itself (rotationAlignment "map"), so the
 * arrow follows the compass at display rate without any GeoJSON round trip through the map worker.
 * Arrow when a direction is known (compass, or course while riding), dot otherwise.
 */
import { type MapLibreMap, Marker } from 'maplibre-gl';

let marker: Marker | null = null;
let el: HTMLDivElement | null = null;

function element(): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'me-marker';
  d.setAttribute('aria-hidden', 'true');
  d.innerHTML =
    '<span class="me-halo"></span>' +
    '<svg class="me-arrow" viewBox="0 0 48 48" width="44" height="44"><path d="M24 5 38 39 24 31.5 10 39Z" /></svg>' +
    '<span class="me-dot"></span>';
  return d;
}

export function setMe(map: MapLibreMap, point: [number, number] | null, heading: number | null) {
  if (!point) {
    marker?.remove();
    marker = null;
    return;
  }
  if (!el) el = element();
  if (!marker) {
    marker = new Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(point).addTo(map);
  } else {
    marker.setLngLat(point);
  }
  const hasHeading = heading !== null;
  el.classList.toggle('has-heading', hasHeading);
  el.dataset['heading'] = String(hasHeading ? Math.round(heading * 10) / 10 : -1);
  marker.setRotation(hasHeading ? heading : 0);
}

/** The marker lives in the DOM: it survives style swaps, but not a new map instance. */
export function dropMe() {
  marker?.remove();
  marker = null;
}
