/**
 * Phase 1 command-line router (SPEC §11):
 *
 *   pnpm route "45.4642,9.1900" "45.4520,9.1770" --level 2 [--out out/route.geojson]
 *
 * Prints the statistics of levels 0, chosen and 3 and writes a GeoJSON of the three routes.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RoutingEngine } from '../src/core/engine.ts';
import { loadGraph } from './lib/load-graph.ts';
import { ROUTE_HEADERS, fmtM, routeRow, routesToGeoJSON } from './lib/route-format.ts';

const args = process.argv.slice(2).filter((a) => a !== '--');
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const level = Number(flag('--level') ?? 2);
const out = flag('--out') ?? 'out/route.geojson';
const parsePoint = (s: string | undefined) => {
  const m = s?.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) throw new Error(`expected "lat,lon", got "${s ?? ''}"`);
  return { lat: Number(m[1]), lon: Number(m[2]) };
};

async function main() {
  if (args.length !== 2 || ![0, 1, 2, 3].includes(level)) {
    console.error('usage: pnpm route "<lat,lon>" "<lat,lon>" [--level 0|1|2|3] [--out file.geojson]');
    process.exit(2);
  }
  const from = parsePoint(args[0]);
  const to = parsePoint(args[1]);
  const t0 = performance.now();
  const graph = await loadGraph();
  const engine = new RoutingEngine(graph);
  const tLoad = performance.now() - t0;
  for (const l of [0, level, 3]) engine.costsFor(l); // warm the cost cache so timing reflects routing only
  const res = engine.route(from, to, level);
  if (!res.ok) {
    const msg = { 'start-off-network': 'départ hors réseau (> 100 m)', 'end-off-network': 'arrivée hors réseau (> 100 m)', 'no-route': 'aucun itinéraire' }[res.error];
    console.error(`Erreur : ${msg}`);
    process.exit(1);
  }
  console.log(`Graphe chargé en ${Math.round(tLoad)} ms (OSM ${graph.header.osmBase?.slice(0, 10) ?? '?'}). Accrochage : départ à ${fmtM(res.from.dist)}, arrivée à ${fmtM(res.to.dist)}.`);
  console.log(`${res.routes.length} calculs en ${Math.round(res.ms)} ms.\n`);
  const rows = [ROUTE_HEADERS, ...res.routes.map(routeRow)];
  const widths = ROUTE_HEADERS.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i]!)).join('  '));
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, JSON.stringify(routesToGeoJSON(res.routes)));
  console.log(`\nGeoJSON : ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
