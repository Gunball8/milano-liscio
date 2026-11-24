/**
 * Registers the pmtiles:// protocol once and serves the archive from a Blob read out of Cache Storage
 * (SPEC §8: no HTTP range requests through the service worker).
 */
import { addProtocol, setWorkerUrl } from 'maplibre-gl';
// MapLibre resolves its worker next to its own module, which no longer exists once bundled:
// let Vite emit the (self-contained) worker file and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { FileSource, PMTiles, Protocol } from 'pmtiles';
import { PMTILES_NAME } from './style.ts';

setWorkerUrl(workerUrl);

let protocol: Protocol | null = null;

export function registerArchive(blob: Blob) {
  if (!protocol) {
    protocol = new Protocol();
    addProtocol('pmtiles', protocol.tile);
  }
  // FileSource keys the archive by file name, which the style references as pmtiles://milano.pmtiles.
  protocol.add(new PMTiles(new FileSource(new File([blob], PMTILES_NAME))));
}
