import { MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { readDataFile } from '../../storage/dataCache.ts';
import { registerArchive } from '../map/pmtiles.ts';
import { PMTILES_NAME, buildStyle } from '../map/style.ts';
import { useApp } from '../store.ts';
import { useColorScheme } from '../useColorScheme.ts';

const DUOMO: [number, number] = [9.1919, 45.4641];
const BOUNDS_PAD = 0.05;

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const version = useApp((s) => s.installed?.version);
  const bbox = useApp((s) => s.installed?.bbox);
  const mapKey = useApp((s) => s.mapKey);
  const scheme = useColorScheme();
  const schemeRef = useRef(scheme);
  schemeRef.current = scheme;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!version || !bbox || !container.current) return;
    let cancelled = false;
    let map: MapLibreMap | null = null;
    (async () => {
      try {
        const blob = await readDataFile(version, PMTILES_NAME);
        if (cancelled || !container.current) return;
        registerArchive(blob);
        const [w, s, e, n] = bbox;
        map = new MapLibreMap({
          container: container.current,
          style: buildStyle(schemeRef.current),
          center: DUOMO,
          zoom: 13,
          minZoom: 10,
          maxZoom: 18,
          maxBounds: [
            [w - BOUNDS_PAD, s - BOUNDS_PAD],
            [e + BOUNDS_PAD, n + BOUNDS_PAD],
          ],
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.touchZoomRotate.disableRotation();
        mapRef.current = map;
        (globalThis as unknown as { __map?: MapLibreMap }).__map = map;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, [version, bbox, mapKey]);

  useEffect(() => {
    mapRef.current?.setStyle(buildStyle(scheme));
  }, [scheme]);

  return (
    <>
      <div ref={container} className="map" />
      {error && <div className="toast error">Carte indisponible : {error}</div>}
    </>
  );
}
