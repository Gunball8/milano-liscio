/**
 * Phase 1: builds public/data/milano-graph.bin from data/raw/ (SPEC §6).
 *
 *   pnpm data:graph
 *
 * Steps: bike access per direction (§6.1), effective surface per direction (§6.2), embedded rails at
 * D = 3 m and shallow crossings (§6.3), split at shared nodes without merging across ways (§6.4),
 * largest connected component only, compact binary output.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type BikeMode,
  SURFACE_CLASSES,
  SURFACE_CODE,
  type Tags,
  directionalAccess,
  effectiveSurface,
  hasTaggedRails,
  isArea,
  isCarriageway,
  isPresentRail,
} from '../src/core/classify.ts';
import { COORD_SCALE, FLAG_PUSH, type GraphArrays, serializeGraph } from '../src/core/graph.ts';
import { splitIntoEdges } from './lib/edges.ts';
import { type OsmWay, readRaw, readTiles } from './lib/osm.ts';
import { readFetchLog } from './lib/overpass.ts';
import {
  RAIL_D_M,
  RailIndex,
  type RailInput,
  countShallowCrossings,
  isRailMarked,
  parseLayer,
  railLength,
  sampleEdgeRails,
} from './lib/rails.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public/data/milano-graph.bin');
const SIZE_WARN_MB = 30;

interface ArcSpec {
  from: number;
  to: number;
  edge: number; // ~edge when reversed
  flags: number;
  rail: number;
  cross: number;
}

class UnionFind {
  private parent = new Map<number, number>();
  find(x: number): number {
    let root = x;
    for (;;) {
      const p = this.parent.get(root);
      if (p === undefined) {
        this.parent.set(root, root);
        break;
      }
      if (p === root) break;
      root = p;
    }
    for (let cur = x; cur !== root; ) {
      const next: number = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

async function main() {
  const t0 = Date.now();
  const highways = (await readTiles('highways')).filter((e): e is OsmWay => e.type === 'way' && !!e.geometry && !!e.tags?.['highway']);
  const railWays = (await readRaw('rails')).filter((e): e is OsmWay => e.type === 'way' && !!e.geometry);
  const log = await readFetchLog();
  const osmBase = log.filter((e) => e.name === 'highways').at(-1)?.osmBase ?? null;

  // 1. ways with at least one usable direction
  const kept = highways
    .map((w) => ({ w, tags: w.tags as Tags, acc: directionalAccess(w.tags as Tags) }))
    .filter((k) => k.acc.forward !== 'excluded' || k.acc.backward !== 'excluded');
  const edges = splitIntoEdges(kept.map((k) => k.w));
  console.log(`${highways.length} highway ways, ${kept.length} usable by bike, ${edges.length} edges`);

  // 2. rails
  const presentRails = railWays.filter((w) => isPresentRail(w.tags ?? {}));
  const railIndex = new RailIndex(
    presentRails.map((w): RailInput => ({ coords: w.geometry!.map((g) => [g.lon, g.lat]), layer: parseLayer(w.tags?.['layer']) })),
    RAIL_D_M,
  );

  // 3. connectivity: keep the largest component
  const uf = new UnionFind();
  for (const e of edges) uf.union(e.startNode, e.endNode);
  const compSize = new Map<number, number>();
  for (const e of edges) {
    const r = uf.find(e.startNode);
    compSize.set(r, (compSize.get(r) ?? 0) + e.length);
  }
  const [mainRoot, mainLen] = [...compSize.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const totalLen = [...compSize.values()].reduce((a, b) => a + b, 0);
  const mainEdges = edges.filter((e) => uf.find(e.startNode) === mainRoot);
  console.log(
    `largest component: ${(mainLen / 1000).toFixed(0)} km of ${(totalLen / 1000).toFixed(0)} km (${compSize.size - 1} small components dropped, ${((totalLen - mainLen) / 1000).toFixed(1)} km)`,
  );

  // 4. nodes, edges, arcs
  const nodeIndex = new Map<number, number>();
  const nodeLon: number[] = [];
  const nodeLat: number[] = [];
  const nodeOf = (osmId: number, lon: number, lat: number) => {
    let i = nodeIndex.get(osmId);
    if (i === undefined) {
      i = nodeLon.length;
      nodeIndex.set(osmId, i);
      nodeLon.push(Math.round(lon * COORD_SCALE));
      nodeLat.push(Math.round(lat * COORD_SCALE));
    }
    return i;
  };
  const wayIndex = new Map<number, number>(); // kept index → graph way index
  const graphWays: OsmWay[] = [];
  const arcs: ArcSpec[] = [];
  const edgeLength = new Float32Array(mainEdges.length);
  const edgeFrom = new Uint32Array(mainEdges.length);
  const edgeTo = new Uint32Array(mainEdges.length);
  const edgeWay = new Uint32Array(mainEdges.length);
  const edgeCoordStart = new Uint32Array(mainEdges.length + 1);
  let coordCount = 0; // interior points only (graph v2)
  for (const e of mainEdges) coordCount += e.ll.length / 2 - 2;
  const coordLon = new Int32Array(coordCount);
  const coordLat = new Int32Array(coordCount);

  const stats = { railMarkedM: 0, taggedRailM: 0, crossings: 0, rideM: 0, pushM: 0, byClass: new Map<string, number>() };
  let c = 0;
  mainEdges.forEach((e, ei) => {
    const k = kept[e.wayIdx]!;
    const n = e.ll.length / 2;
    const from = nodeOf(e.startNode, e.ll[0]!, e.ll[1]!);
    const to = nodeOf(e.endNode, e.ll[2 * n - 2]!, e.ll[2 * n - 1]!);
    let wi = wayIndex.get(e.wayIdx);
    if (wi === undefined) {
      wi = graphWays.length;
      wayIndex.set(e.wayIdx, wi);
      graphWays.push(k.w);
    }
    edgeLength[ei] = e.length;
    edgeFrom[ei] = from;
    edgeTo[ei] = to;
    edgeWay[ei] = wi;
    edgeCoordStart[ei] = c;
    for (let i = 1; i < n - 1; i++) {
      coordLon[c] = Math.round(e.ll[2 * i]! * COORD_SCALE);
      coordLat[c] = Math.round(e.ll[2 * i + 1]! * COORD_SCALE);
      c++;
    }

    const layer = parseLayer(k.tags['layer']);
    let rail = 0;
    if (hasTaggedRails(k.tags)) {
      rail = e.length;
      stats.taggedRailM += e.length;
    } else if (isCarriageway(k.tags) && !isArea(k.tags)) {
      const rl = railLength(sampleEdgeRails(e.xy, e.length, railIndex, layer), RAIL_D_M);
      if (isRailMarked(rl, e.length)) rail = rl;
    }
    stats.railMarkedM += rail;
    const cross = countShallowCrossings(e.xy, railIndex, layer);
    stats.crossings += cross;

    const addArc = (mode: BikeMode, reversed: boolean) => {
      if (mode === 'excluded') return;
      const cls = effectiveSurface(k.tags, reversed ? 'backward' : 'forward').cls;
      arcs.push({
        from: reversed ? to : from,
        to: reversed ? from : to,
        edge: reversed ? ~ei : ei,
        flags: SURFACE_CODE[cls] | (mode === 'push' ? FLAG_PUSH : 0),
        rail: Math.min(65535, Math.round(rail)),
        cross: Math.min(255, cross),
      });
      if (mode === 'push') stats.pushM += e.length;
      else stats.rideM += e.length;
      stats.byClass.set(cls, (stats.byClass.get(cls) ?? 0) + e.length);
    };
    addArc(k.acc.forward, false);
    addArc(k.acc.backward, true);
  });
  edgeCoordStart[mainEdges.length] = c;

  // CSR by source node
  const nodeCount = nodeLon.length;
  const firstArc = new Uint32Array(nodeCount + 1);
  for (const a of arcs) firstArc[a.from + 1]!++;
  for (let i = 0; i < nodeCount; i++) firstArc[i + 1]! += firstArc[i]!;
  const fill = firstArc.slice(0, nodeCount);
  const arcTarget = new Uint32Array(arcs.length);
  const arcEdge = new Int32Array(arcs.length);
  const arcFlags = new Uint8Array(arcs.length);
  const arcRail = new Uint16Array(arcs.length);
  const arcCross = new Uint8Array(arcs.length);
  for (const a of arcs) {
    const i = fill[a.from]!++;
    arcTarget[i] = a.to;
    arcEdge[i] = a.edge;
    arcFlags[i] = a.flags;
    arcRail[i] = a.rail;
    arcCross[i] = a.cross;
  }

  // ways table
  const names: string[] = [];
  const nameIdx = new Map<string, number>();
  const wayId = new Float64Array(graphWays.length);
  const wayName = new Int32Array(graphWays.length);
  const wayDay = new Uint16Array(graphWays.length);
  graphWays.forEach((w, i) => {
    wayId[i] = w.id;
    const name = w.tags?.['name'];
    if (name) {
      let ni = nameIdx.get(name);
      if (ni === undefined) {
        ni = names.length;
        nameIdx.set(name, ni);
        names.push(name);
      }
      wayName[i] = ni;
    } else wayName[i] = -1;
    wayDay[i] = w.timestamp ? Math.floor(Date.parse(w.timestamp) / 86_400_000) : 0;
  });

  const arrays: GraphArrays = {
    nodeLon: Int32Array.from(nodeLon),
    nodeLat: Int32Array.from(nodeLat),
    firstArc,
    arcTarget,
    arcEdge,
    arcFlags,
    arcRail,
    arcCross,
    edgeLength,
    edgeFrom,
    edgeTo,
    edgeWay,
    edgeCoordStart,
    coordLon,
    coordLat,
    wayId,
    wayName,
    wayDay,
  };
  const bin = serializeGraph(
    {
      builtAt: new Date().toISOString(),
      osmBase,
      railD: RAIL_D_M,
      nodeCount,
      arcCount: arcs.length,
      edgeCount: mainEdges.length,
      coordCount,
      wayCount: graphWays.length,
      names,
    },
    arrays,
  );
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, bin);

  const mb = bin.byteLength / 1e6;
  console.log(`nodes ${nodeCount}, arcs ${arcs.length}, edges ${mainEdges.length}, coords ${coordCount}, ways ${graphWays.length}, names ${names.length}`);
  console.log(
    `arc km: ride ${(stats.rideM / 1000).toFixed(0)}, push ${(stats.pushM / 1000).toFixed(0)}; by class ${SURFACE_CLASSES.map((k) => `${k} ${((stats.byClass.get(k) ?? 0) / 1000).toFixed(0)}`).join(', ')}`,
  );
  console.log(
    `rails: ${(stats.railMarkedM / 1000).toFixed(1)} km on edges (of which tagged ${(stats.taggedRailM / 1000).toFixed(1)} km), shallow crossings ${stats.crossings}`,
  );
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${mb.toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (mb > SIZE_WARN_MB) console.warn(`WARNING: graph over ${SIZE_WARN_MB} MB, review filtering (SPEC §6.4)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
