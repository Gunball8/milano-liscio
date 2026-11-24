import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type Graph, parseGraph } from '../../src/core/graph.ts';

export const GRAPH_FILE = path.resolve(import.meta.dirname, '../../public/data/milano-graph.bin');

export async function loadGraph(file = GRAPH_FILE): Promise<Graph> {
  const buf = await readFile(file);
  // copy into a dedicated ArrayBuffer so typed-array views are aligned
  return parseGraph(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}
