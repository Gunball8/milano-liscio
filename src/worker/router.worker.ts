/**
 * Routing worker (SPEC §3): keeps the graph and the geocoder in memory, answers search, route and
 * describe requests. Data comes straight from the versioned cache, never from the network.
 */
import { type CorrectionRecord, EdgeLookup, resolveCorrections, surfaceFeatures } from '../core/corrections.ts';
import type { EdgeCorrection } from '../core/cost.ts';
import { RoutingEngine } from '../core/engine.ts';
import { Geocoder } from '../core/geocode.ts';
import { edgeLngLats, parseGraph, wayNameOf } from '../core/graph.ts';
import { WayTags } from '../core/waytags.ts';
import { readDataFile } from '../storage/dataCache.ts';
import type { EdgeInfo, InitInfo, Prefs, Request, RouteResult, WorkerMessage, WorkerReply } from './protocol.ts';

interface WorkerScope {
  postMessage(message: WorkerReply): void;
  onmessage: ((e: MessageEvent<WorkerMessage>) => void) | null;
}
const scope = self as unknown as WorkerScope;

let engine: RoutingEngine | null = null;
let geocoder: Geocoder | null = null;
let loadedVersion: string | null = null;
let lookup: EdgeLookup | null = null;
let overrides = new Map<number, EdgeCorrection>();
let wayTags: WayTags | null = null;

async function init(version: string): Promise<InitInfo> {
  const t0 = performance.now();
  if (loadedVersion !== version) {
    const [graphBuf, geoBuf] = await Promise.all([
      readDataFile(version, 'milano-graph.bin').then((b) => b.arrayBuffer()),
      readDataFile(version, 'milano-geocoder.bin').then((b) => b.arrayBuffer()),
    ]);
    engine = new RoutingEngine(parseGraph(graphBuf));
    geocoder = new Geocoder(geoBuf);
    lookup = new EdgeLookup(engine.graph);
    overrides = new Map();
    wayTags = null;
    for (const level of [0, 1, 2, 3]) engine.costsFor(level); // every request computes the four levels
    loadedVersion = version;
  }
  return { ms: Math.round(performance.now() - t0), nodes: engine!.graph.header.nodeCount, places: geocoder!.entryCount };
}

function need<T>(v: T | null): T {
  if (!v) throw new Error('worker not initialised');
  return v;
}

function route(req: Extract<Request, { type: 'route' }>) {
  const res = need(engine).route(req.from, req.to, req.level, req.levels);
  if (!res.ok) return res;
  const result: RouteResult = {
    routes: res.routes.map((r) => ({
      level: r.level.id,
      label: r.level.label,
      stats: r.route.stats,
      deltaM: r.deltaM,
      deltaPct: r.deltaPct,
      segments: r.route.segments.map((s) => ({ coords: s.coords, cls: s.cls, push: s.push, rail: s.rail, length: s.length })),
    })),
    from: { lon: res.from.lon, lat: res.from.lat, dist: res.from.dist },
    to: { lon: res.to.lon, lat: res.to.lat, dist: res.to.dist },
    ms: Math.round(res.ms),
  };
  return { ok: true as const, result };
}

function setOptions(prefs: Prefs) {
  const e = need(engine);
  e.speeds = { ride: prefs.speed, push: 4.5 };
  e.setCostOptions({ allowPush: prefs.allowPush });
  e.setPenaltyFactors(prefs.factors);
  return true as const;
}

function setCorrections(list: CorrectionRecord[]) {
  const { statuses, overrides: o } = resolveCorrections(need(lookup), list);
  overrides = o;
  need(engine).setCorrections(o);
  return statuses;
}

function edgeInfo(e: number): EdgeInfo {
  const l = need(lookup);
  const g = l.g;
  const way = g.edgeWay[e]!;
  const day = g.wayDay[way]!;
  return {
    edge: e,
    wayId: g.wayId[way]!,
    name: wayNameOf(g, way),
    length: g.edgeLength[e]!,
    osmDate: day > 0 ? new Date(day * 86_400_000).toISOString().slice(0, 10) : null,
    mid: l.midpoint(e),
    coords: edgeLngLats(g, e),
    osm: l.osmState(e),
    effective: l.effectiveState(e, overrides),
  };
}

async function tagsOf(e: number) {
  if (!wayTags) wayTags = new WayTags(await (await readDataFile(need(loadedVersionOrNull()), 'milano-ways.bin')).arrayBuffer());
  return wayTags.tags(need(lookup).g.edgeWay[e]!);
}

const loadedVersionOrNull = () => loadedVersion;

function describe(point: { lon: number; lat: number }) {
  const e = need(engine);
  const s = e.snap.nearest(point.lon, point.lat, 150);
  if (!s) return null;
  return { street: wayNameOf(e.graph, e.graph.edgeWay[s.edge]!), dist: s.dist };
}

scope.onmessage = async (event) => {
  const { id, ...req } = event.data;
  try {
    let result: unknown;
    switch (req.type) {
      case 'init':
        result = await init(req.version);
        break;
      case 'search':
        result = need(geocoder).search(req.query, req.limit ?? 8);
        break;
      case 'route':
        result = route(req);
        break;
      case 'describe':
        result = describe(req.point);
        break;
      case 'setOptions':
        result = setOptions(req.prefs);
        break;
      case 'setCorrections':
        result = setCorrections(req.corrections);
        break;
      case 'surface':
        result = surfaceFeatures(need(lookup), overrides, req.bbox);
        break;
      case 'edgeAt': {
        const snap = need(engine).snap.nearest(req.point.lon, req.point.lat, 40);
        result = snap ? edgeInfo(snap.edge) : null;
        break;
      }
      case 'edgeInfo':
        result = edgeInfo(req.edge);
        break;
      case 'street':
        result = need(lookup).streetEdges(req.edge).map(edgeInfo);
        break;
      case 'tags':
        result = await tagsOf(req.edge);
        break;
      case 'geometryOf':
        result = req.corrections.map((c) => {
          const e = need(lookup).attach(c);
          return e >= 0 ? edgeLngLats(need(lookup).g, e) : null;
        });
        break;
    }
    scope.postMessage({ id, ok: true, result });
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
