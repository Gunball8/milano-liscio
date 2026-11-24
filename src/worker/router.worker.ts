/**
 * Routing worker (SPEC §3): keeps the graph and the geocoder in memory, answers search, route and
 * describe requests. Data comes straight from the versioned cache, never from the network.
 */
import { RoutingEngine } from '../core/engine.ts';
import { Geocoder } from '../core/geocode.ts';
import { parseGraph, wayNameOf } from '../core/graph.ts';
import { readDataFile } from '../storage/dataCache.ts';
import type { InitInfo, Request, RouteResult, WorkerMessage, WorkerReply } from './protocol.ts';

interface WorkerScope {
  postMessage(message: WorkerReply): void;
  onmessage: ((e: MessageEvent<WorkerMessage>) => void) | null;
}
const scope = self as unknown as WorkerScope;

let engine: RoutingEngine | null = null;
let geocoder: Geocoder | null = null;
let loadedVersion: string | null = null;

async function init(version: string): Promise<InitInfo> {
  const t0 = performance.now();
  if (loadedVersion !== version) {
    const [graphBuf, geoBuf] = await Promise.all([
      readDataFile(version, 'milano-graph.bin').then((b) => b.arrayBuffer()),
      readDataFile(version, 'milano-geocoder.bin').then((b) => b.arrayBuffer()),
    ]);
    engine = new RoutingEngine(parseGraph(graphBuf));
    geocoder = new Geocoder(geoBuf);
    for (const level of [0, 2, 3]) engine.costsFor(level);
    loadedVersion = version;
  }
  return { ms: Math.round(performance.now() - t0), nodes: engine!.graph.header.nodeCount, places: geocoder!.entryCount };
}

function need<T>(v: T | null): T {
  if (!v) throw new Error('worker not initialised');
  return v;
}

function route(req: Extract<Request, { type: 'route' }>) {
  const res = need(engine).route(req.from, req.to, req.level);
  if (!res.ok) return res;
  const result: RouteResult = {
    routes: res.routes.map((r) => ({
      level: r.level.id,
      label: r.level.label,
      stats: r.route.stats,
      deltaM: r.deltaM,
      deltaPct: r.deltaPct,
      segments: r.route.segments.map((s) => ({ coords: s.coords, cls: s.cls, push: s.push, rail: s.rail })),
    })),
    from: { lon: res.from.lon, lat: res.from.lat, dist: res.from.dist },
    to: { lon: res.to.lon, lat: res.to.lat, dist: res.to.dist },
    ms: Math.round(res.ms),
  };
  return { ok: true as const, result };
}

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
    }
    scope.postMessage({ id, ok: true, result });
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
