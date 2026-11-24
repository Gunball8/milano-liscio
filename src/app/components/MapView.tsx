import { type LngLatBoundsLike, MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { readDataFile } from '../../storage/dataCache.ts';
import { registerArchive } from '../map/pmtiles.ts';
import { ALT_HIT_LAYER, addRouteLayers, keepRouteLayers, routeData, setRouteData } from '../map/routeLayers.ts';
import { PMTILES_NAME, buildStyle } from '../map/style.ts';
import { openMenu, selectAlternative } from '../routing/actions.ts';
import { type AppState, useApp } from '../store.ts';
import { type Scheme, useColorScheme } from '../useColorScheme.ts';

const DUOMO: [number, number] = [9.1919, 45.4641];
const BOUNDS_PAD = 0.05;
const LONG_PRESS_MS = 550;

function pointsOf(s: AppState) {
  const at = (e: AppState['from'] | null) =>
    e?.kind === 'place' && e.lon !== undefined && e.lat !== undefined ? ([e.lon, e.lat] as [number, number]) : null;
  const me = s.position ? ([s.position.lon, s.position.lat] as [number, number]) : null;
  return { from: at(s.from) ?? (s.from.kind === 'position' && s.routes ? me : null), to: at(s.to), me };
}

function pushRoute(map: MapLibreMap) {
  const s = useApp.getState();
  setRouteData(map, routeData(s.routes, s.selected, pointsOf(s)));
}

function panelHeight(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-h')) || 0;
}

function fitRoutes(map: MapLibreMap) {
  const routes = useApp.getState().routes;
  if (!routes?.length) return;
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of routes) for (const seg of r.segments) for (const [x, y] of seg.coords) b = [Math.min(b[0]!, x), Math.min(b[1]!, y), Math.max(b[2]!, x), Math.max(b[3]!, y)];
  map.fitBounds(b as LngLatBoundsLike, { padding: { top: 170, bottom: panelHeight() + 30, left: 40, right: 40 }, maxZoom: 16, duration: 400 });
}

function installLongPress(map: MapLibreMap) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    start = null;
  };
  map.on('touchstart', (e) => {
    if (e.originalEvent.touches.length !== 1) return cancel();
    start = { x: e.point.x, y: e.point.y };
    const { lng, lat } = e.lngLat;
    const { x, y } = e.point;
    timer = setTimeout(() => {
      timer = null;
      if (!useApp.getState().menu) void openMenu(lng, lat, x, y);
    }, LONG_PRESS_MS);
  });
  map.on('touchmove', (e) => {
    if (start && Math.hypot(e.point.x - start.x, e.point.y - start.y) > 10) cancel();
  });
  map.on('touchend', cancel);
  map.on('touchcancel', cancel);
  map.on('dragstart', cancel);
  map.on('zoomstart', cancel);
  // Right click on desktop; some browsers also fire it for a long touch, so drop our own timer then.
  map.on('contextmenu', (e) => {
    e.preventDefault();
    cancel();
    void openMenu(e.lngLat.lng, e.lngLat.lat, e.point.x, e.point.y);
  });
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const version = useApp((s) => s.installed?.version);
  const bbox = useApp((s) => s.installed?.bbox);
  const mapKey = useApp((s) => s.mapKey);
  const scheme = useColorScheme();
  const schemeRef = useRef<Scheme>(scheme);
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
        const m = map;
        m.on('load', () => {
          addRouteLayers(m, schemeRef.current);
          pushRoute(m);
          fitRoutes(m);
        });
        m.on('click', ALT_HIT_LAYER, (ev) => {
          const level = ev.features?.[0]?.properties?.['level'];
          if (level !== undefined) selectAlternative(Number(level));
        });
        m.on('mouseenter', ALT_HIT_LAYER, () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', ALT_HIT_LAYER, () => (m.getCanvas().style.cursor = ''));
        installLongPress(m);
        mapRef.current = m;
        (globalThis as unknown as { __map?: MapLibreMap }).__map = m;
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

  // Route, endpoints and position follow the store.
  useEffect(
    () =>
      useApp.subscribe((s, prev) => {
        const m = mapRef.current;
        if (!m || !m.getSource('liscio-route')) return;
        if (s.routes !== prev.routes || s.selected !== prev.selected || s.from !== prev.from || s.to !== prev.to || s.position !== prev.position) pushRoute(m);
        // wait for the route panel to take its final height before framing the route
        if (s.routes !== prev.routes) setTimeout(() => fitRoutes(m), 80);
      }),
    [],
  );

  // Light/dark switch: new basemap, our layers rebuilt with the matching colours.
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    m.once('style.load', () => {
      for (const id of ['lr-alt', 'lr-rail', 'lr-casing', 'lr-main', 'lr-push', 'lr-me', 'lr-ends', ALT_HIT_LAYER]) if (m.getLayer(id)) m.removeLayer(id);
      addRouteLayers(m, scheme);
      pushRoute(m);
    });
    m.setStyle(buildStyle(scheme), { diff: false, transformStyle: keepRouteLayers });
  }, [scheme]);

  return (
    <>
      <div ref={container} className="map" />
      {error && <div className="toast error">Carte indisponible : {error}</div>}
    </>
  );
}
