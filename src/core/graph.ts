/**
 * Routing graph: binary format, writer and reader (SPEC §6.4). Pure TypeScript, shared by the
 * Node build and the routing worker.
 *
 * File layout: magic u32 | version u32 | header length u32 | JSON header (padded to 8 bytes) | typed arrays (8-byte aligned).
 * Coordinates are Int32 at 1e-7 degree. OSM node ids are not stored (SPEC §13 pitfall 7).
 *
 * Model: undirected *edges* carry geometry, length and the OSM way; directed *arcs* (CSR by source node)
 * carry per-direction attributes. arcEdge[a] = e when the arc follows the edge geometry, ~e when reversed.
 */

export const GRAPH_MAGIC = 0x4d4c4752; // "MLGR"
export const GRAPH_VERSION = 1;
export const COORD_SCALE = 1e7;

/** arcFlags bits: surface class code in bits 0–2, push in bit 3. */
export const FLAG_CLASS_MASK = 0b0111;
export const FLAG_PUSH = 0b1000;

export interface GraphHeader {
  version: number;
  builtAt: string;
  osmBase: string | null;
  railD: number;
  nodeCount: number;
  arcCount: number;
  edgeCount: number;
  coordCount: number;
  wayCount: number;
  /** Street names, indexed by wayName. */
  names: string[];
  arrays: Record<string, { offset: number; length: number; type: ArrayTypeName }>;
}

type ArrayTypeName = 'Int32' | 'Uint32' | 'Uint16' | 'Uint8' | 'Float32' | 'Float64';
type TypedArray = Int32Array | Uint32Array | Uint16Array | Uint8Array | Float32Array | Float64Array;

export interface GraphArrays {
  /** Node coordinates, 1e-7 degree. */
  nodeLon: Int32Array;
  nodeLat: Int32Array;
  /** CSR: arcs of node n are firstArc[n] .. firstArc[n+1]-1. */
  firstArc: Uint32Array;
  arcTarget: Uint32Array;
  arcEdge: Int32Array;
  arcFlags: Uint8Array;
  /** Meters along embedded rails (0 when the edge is not marked). */
  arcRail: Uint16Array;
  /** Rails crossed at a shallow angle. */
  arcCross: Uint8Array;
  edgeLength: Float32Array;
  /** Endpoints: the forward arc goes edgeFrom → edgeTo. */
  edgeFrom: Uint32Array;
  edgeTo: Uint32Array;
  edgeWay: Uint32Array;
  /** Geometry of edge e: coords edgeCoordStart[e] .. edgeCoordStart[e+1]-1, first = source node of the forward arc. */
  edgeCoordStart: Uint32Array;
  coordLon: Int32Array;
  coordLat: Int32Array;
  wayId: Float64Array;
  /** Index into header.names, -1 when unnamed. */
  wayName: Int32Array;
  /** Last OSM modification, days since 1970-01-01. */
  wayDay: Uint16Array;
}

export interface Graph extends GraphArrays {
  header: GraphHeader;
}

const ARRAY_TYPES: Record<keyof GraphArrays, ArrayTypeName> = {
  nodeLon: 'Int32',
  nodeLat: 'Int32',
  firstArc: 'Uint32',
  arcTarget: 'Uint32',
  arcEdge: 'Int32',
  arcFlags: 'Uint8',
  arcRail: 'Uint16',
  arcCross: 'Uint8',
  edgeLength: 'Float32',
  edgeFrom: 'Uint32',
  edgeTo: 'Uint32',
  edgeWay: 'Uint32',
  edgeCoordStart: 'Uint32',
  coordLon: 'Int32',
  coordLat: 'Int32',
  wayId: 'Float64',
  wayName: 'Int32',
  wayDay: 'Uint16',
};

const CTORS = {
  Int32: Int32Array,
  Uint32: Uint32Array,
  Uint16: Uint16Array,
  Uint8: Uint8Array,
  Float32: Float32Array,
  Float64: Float64Array,
} as const;

const align8 = (n: number) => (n + 7) & ~7;

export function serializeGraph(header: Omit<GraphHeader, 'arrays' | 'version'>, arrays: GraphArrays): Uint8Array {
  const names = Object.keys(ARRAY_TYPES) as (keyof GraphArrays)[];
  const layout: GraphHeader['arrays'] = {};
  let offset = 0;
  for (const name of names) {
    const a = arrays[name] as TypedArray;
    if (!(a instanceof CTORS[ARRAY_TYPES[name]])) throw new Error(`graph array ${name} must be ${ARRAY_TYPES[name]}Array`);
    layout[name] = { offset, length: a.length, type: ARRAY_TYPES[name] };
    offset = align8(offset + a.byteLength);
  }
  const fullHeader: GraphHeader = { ...header, version: GRAPH_VERSION, arrays: layout };
  const json = new TextEncoder().encode(JSON.stringify(fullHeader));
  const dataStart = align8(12 + json.length);
  const out = new Uint8Array(dataStart + offset);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, GRAPH_MAGIC, true);
  dv.setUint32(4, GRAPH_VERSION, true);
  dv.setUint32(8, json.length, true);
  out.set(json, 12);
  for (const name of names) {
    const a = arrays[name] as TypedArray;
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), dataStart + layout[name]!.offset);
  }
  return out;
}

/** Wraps a graph file without copying (the buffer must stay alive). */
export function parseGraph(buffer: ArrayBuffer): Graph {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== GRAPH_MAGIC) throw new Error('not a Milano Liscio graph file');
  const version = dv.getUint32(4, true);
  if (version !== GRAPH_VERSION) throw new Error(`graph version ${version}, expected ${GRAPH_VERSION}`);
  const jsonLen = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, jsonLen))) as GraphHeader;
  const dataStart = align8(12 + jsonLen);
  const arrays = {} as Record<string, TypedArray>;
  for (const [name, { offset, length, type }] of Object.entries(header.arrays)) {
    arrays[name] = new CTORS[type](buffer, dataStart + offset, length);
  }
  return { header, ...(arrays as unknown as GraphArrays) };
}

// ---------- small accessors ----------

export const arcClass = (g: Graph, arc: number) => g.arcFlags[arc]! & FLAG_CLASS_MASK;
export const arcIsPush = (g: Graph, arc: number) => (g.arcFlags[arc]! & FLAG_PUSH) !== 0;
export const arcEdgeIndex = (g: Graph, arc: number) => {
  const e = g.arcEdge[arc]!;
  return e >= 0 ? e : ~e;
};
export const arcReversed = (g: Graph, arc: number) => g.arcEdge[arc]! < 0;
export const arcLength = (g: Graph, arc: number) => g.edgeLength[arcEdgeIndex(g, arc)]!;

/** Source node of an arc (CSR stores only targets): binary search on firstArc. */
export function arcSource(g: Graph, arc: number): number {
  let lo = 0;
  let hi = g.header.nodeCount - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.firstArc[mid]! <= arc) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The arc that traverses edge e in the given direction, or -1. */
export function findArc(g: Graph, edge: number, reversed: boolean, fromNode: number): number {
  const want = reversed ? ~edge : edge;
  for (let a = g.firstArc[fromNode]!; a < g.firstArc[fromNode + 1]!; a++) if (g.arcEdge[a] === want) return a;
  return -1;
}

export function wayNameOf(g: Graph, way: number): string | null {
  const i = g.wayName[way]!;
  return i >= 0 ? (g.header.names[i] ?? null) : null;
}
