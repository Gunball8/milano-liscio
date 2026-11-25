import { AttributionControl, type LngLatBoundsLike, MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { readDataFile } from '../../storage/dataCache.ts';
import { registerArchive } from '../map/pmtiles.ts';
import { REPORTS_SOURCE, SELECTION_SOURCE, SURFACE_LAYERS, SURFACE_MIN_ZOOM, SURFACE_SOURCE, EMPTY, addCorrectionLayers, setData } from '../map/correctionLayers.ts';
import { addMeLayer, setMe } from '../map/meLayer.ts';
import { ALT_HIT_LAYER, addRouteLayers, keepRouteLayers, routeData, setRouteData } from '../map/routeLayers.ts';
import { PMTILES_NAME, buildStyle } from '../map/style.ts';
import { selectEdgeAt } from '../corrections/actions.ts';
import { openMenu, selectAlternative } from '../routing/actions.ts';
import { call } from '../routing/client.ts';
import { setFollowing } from '../tracking/session.ts';
import { type AppState, useApp } from '../store.ts';
import { type Scheme, useColorScheme } from '../useColorScheme.ts';

const DUOMO: [number, number] = [9.1919, 45.4641];
const BOUNDS_PAD = 0.05;
const LONG_PRESS_MS = 550;

function pointsOf(s: AppState) {
  const at = (e: AppState['from'] | null) =>
    e?.kind === 'place' && e.lon !== undefined && e.lat !== undefined ? ([e.lon, e.lat] as [number, number]) : null;
  const me = s.position ? ([s.position.lon, s.position.lat] as [number, number]) : null;
  if (s.mode === 'tracking') return { from: null, to: at(s.to) };
  return { from: at(s.from) ?? (s.from.kind === 'position' && s.routes ? me : null), to: at(s.to) };
}

/** Arrow where the phone points (compass); while tracking without compass, the course. */
function pushMe(map: MapLibreMap) {
  const s = useApp.getState();
  const heading = s.compass ?? (s.mode === 'tracking' ? (s.tracking?.course ?? null) : null);
  setMe(map, s.position ? [s.position.lon, s.position.lat] : null, heading);
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

// ---------- corrections (SPEC §9.3) ----------

let surfaceSeq = 0;

/** Surface layer for the viewport, computed by the worker from the graph and the corrections. */
async function refreshSurface(map: MapLibreMap) {
  const s = useApp.getState();
  const visible = s.mode === 'corrections' || s.surfaceLayer;
  for (const id of SURFACE_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  const zoomOk = map.getZoom() >= SURFACE_MIN_ZOOM;
  if (s.surfaceZoomOk !== zoomOk) useApp.setState({ surfaceZoomOk: zoomOk });
  if (!visible || !zoomOk || s.engine !== 'ready') {
    setData(map, SURFACE_SOURCE, EMPTY);
    return;
  }
  const seq = ++surfaceSeq;
  const b = map.getBounds();
  const res = await call({ type: 'surface', bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] });
  if (seq === surfaceSeq) setData(map, SURFACE_SOURCE, { type: 'FeatureCollection', features: res.features });
}

function pushSelection(map: MapLibreMap) {
  const s = useApp.getState();
  const edges = s.mode === 'corrections' ? (s.street ?? (s.selectedEdge ? [s.selectedEdge] : [])) : [];
  setData(map, SELECTION_SOURCE, {
    type: 'FeatureCollection',
    features: edges.map((e) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: e.coords } })),
  });
  const reports = s.mode === 'corrections' ? s.reports.filter((r) => r.status === 'todo') : [];
  setData(map, REPORTS_SOURCE, {
    type: 'FeatureCollection',
    features: reports.map((r) => ({ type: 'Feature', properties: { id: r.id }, geometry: { type: 'Point', coordinates: [r.lon, r.lat] } })),
  });
}

/** While tracking: keep the position in the lower part of the screen, rotated to the course (SPEC §9.2). */
function follow(map: MapLibreMap) {
  const s = useApp.getState();
  if (s.mode !== 'tracking' || !s.tracking?.following || !s.position) return;
  map.easeTo({
    center: [s.position.lon, s.position.lat],
    bearing: s.tracking.bearing,
    zoom: Math.max(map.getZoom(), 16.5),
    padding: { top: 260, bottom: 140, left: 0, right: 0 },
    duration: 700,
  });
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
    if (e.originalEvent.touches.length !== 1 || useApp.getState().mode === 'tracking') return cancel();
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
    if (useApp.getState().mode === 'tracking') return;
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
          attributionControl: false, // added bottom-left below: the right side holds the locate button
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(new AttributionControl({ compact: true }), 'bottom-left');
        const m = map;
        m.on('load', () => {
          addRouteLayers(m, schemeRef.current);
          addCorrectionLayers(m);
          addMeLayer(m);
          pushRoute(m);
          pushMe(m);
          pushSelection(m);
          void refreshSurface(m);
          fitRoutes(m);
        });
        let moveTimer: ReturnType<typeof setTimeout> | null = null;
        m.on('moveend', () => {
          if (moveTimer) clearTimeout(moveTimer);
          moveTimer = setTimeout(() => void refreshSurface(m), 120);
        });
        // In the Corrections screen a tap picks the nearest street.
        m.on('click', (ev) => {
          if (useApp.getState().mode === 'corrections') void selectEdgeAt(ev.lngLat.lng, ev.lngLat.lat);
        });
        m.on('click', ALT_HIT_LAYER, (ev) => {
          const level = ev.features?.[0]?.properties?.['level'];
          if (level !== undefined) selectAlternative(Number(level));
        });
        m.on('mouseenter', ALT_HIT_LAYER, () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', ALT_HIT_LAYER, () => (m.getCanvas().style.cursor = ''));
        installLongPress(m);
        // A pan by the user while tracking stops the follow mode until "Recentrer".
        m.on('dragstart', (ev) => {
          if ((ev as { originalEvent?: unknown }).originalEvent && useApp.getState().mode === 'tracking') setFollowing(false);
        });
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
        if (s.routes !== prev.routes || s.selected !== prev.selected || s.from !== prev.from || s.to !== prev.to || s.position !== prev.position || s.mode !== prev.mode) pushRoute(m);
        if (s.position !== prev.position || s.compass !== prev.compass || s.tracking?.course !== prev.tracking?.course || s.mode !== prev.mode) pushMe(m);
        if (s.flyTo && s.flyTo !== prev.flyTo) m.flyTo({ center: [s.flyTo.lon, s.flyTo.lat], zoom: s.flyTo.zoom, duration: 600 });
        if (s.mode !== prev.mode || s.surfaceLayer !== prev.surfaceLayer || s.surfaceKey !== prev.surfaceKey || s.engine !== prev.engine) void refreshSurface(m);
        if (s.mode !== prev.mode || s.selectedEdge !== prev.selectedEdge || s.street !== prev.street || s.reports !== prev.reports) pushSelection(m);
        if (s.focusReport && s.focusReport !== prev.focusReport) m.flyTo({ center: [s.focusReport.lon, s.focusReport.lat], zoom: 17, duration: 600 });
        else if (s.mode === 'corrections' && s.selectedEdge && s.selectedEdge.edge !== prev.selectedEdge?.edge && !s.focusReport) {
          const [lon, lat] = s.selectedEdge.mid;
          if (!m.getBounds().contains([lon, lat])) m.flyTo({ center: [lon, lat], zoom: Math.max(m.getZoom(), 16), duration: 500 });
        }
        // Corrections centre the map on reports and segments: drop the route-framing padding.
        if (s.mode === 'corrections' && prev.mode !== 'corrections') m.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 0 });
        if (s.mode === 'corrections') return;
        if (s.mode === 'tracking') {
          const followChanged = s.tracking?.following !== prev.tracking?.following;
          const turned = s.tracking?.bearing !== prev.tracking?.bearing;
          if (s.position !== prev.position || prev.mode !== 'tracking' || followChanged || turned) follow(m);
          return;
        }
        if (prev.mode === 'tracking') {
          m.easeTo({ bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 400 });
          return;
        }
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
      for (const id of ['lr-alt', 'lr-rail', 'lr-casing', 'lr-main', 'lr-push', 'lr-ends', ALT_HIT_LAYER]) if (m.getLayer(id)) m.removeLayer(id);
      addRouteLayers(m, scheme);
      addCorrectionLayers(m);
      addMeLayer(m);
      pushRoute(m);
      pushMe(m);
      pushSelection(m);
      void refreshSurface(m);
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
