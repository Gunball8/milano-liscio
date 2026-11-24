/**
 * Phase 1 calibration table (SPEC §11, §12): the five reference pairs, geocoded by the project's own
 * data, routed at the four levels. Writes docs/calibration.md and docs/calibration.geojson.
 *
 *   pnpm calibrate
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RoutingEngine } from '../src/core/engine.ts';
import { LEVELS } from '../src/core/cost.ts';
import { loadGraph } from './lib/load-graph.ts';
import { PlaceIndex } from './lib/places.ts';
import { ROUTE_HEADERS, fmtM, routeRow, routesToGeoJSON } from './lib/route-format.ts';

const DOCS = path.resolve(import.meta.dirname, '../docs');

/** Labels from SPEC §12; queries are the matching OSM names. */
export const REFERENCE_PAIRS = [
  { label: 'Piazza del Duomo → Darsena (Piazza XXIV Maggio)', from: 'Piazza del Duomo', to: 'Piazza Ventiquattro Maggio' },
  { label: 'Piazza Castello → Porta Venezia', from: 'Piazza Castello', to: 'Porta Venezia' },
  { label: 'Stazione Centrale → Università Bocconi (Via Sarfatti)', from: 'Milano Centrale', to: 'Via Roberto Sarfatti' },
  { label: "Piazza Medaglie d'Oro → Basilica di Sant'Ambrogio", from: "Piazzale Medaglie d'Oro", to: "Piazza Sant'Ambrogio" },
  { label: 'Stazione Lambrate → Piazza Leonardo da Vinci (témoin)', from: 'Milano Lambrate', to: 'Piazza Leonardo da Vinci' },
];

const table = (rows: string[][]) =>
  [rows[0]!, rows[0]!.map((_, i) => (i === 0 ? '---' : '---:')), ...rows.slice(1)].map((r) => `| ${r.join(' | ')} |`).join('\n');

async function main() {
  const graph = await loadGraph();
  const engine = new RoutingEngine(graph);
  const places = await PlaceIndex.load();
  const out: string[] = [];
  const features: unknown[] = [];
  const timings: number[] = [];
  const mapPairs: unknown[] = [];
  const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
  out.push('# Calibrage des pénalités (phase 1)');
  out.push('');
  out.push(`Généré par \`pnpm calibrate\` le ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, graphe du ${graph.header.osmBase?.slice(0, 10) ?? '?'} (D = ${graph.header.railD} m). Pénalités de départ du §7. Carte : \`docs/calibration-map.html\`. Ne pas éditer à la main : les commentaires vont dans \`docs/calibration-notes.md\`, inséré ci-dessous.`);
  out.push('');
  const notes = path.join(DOCS, 'calibration-notes.md');
  if (existsSync(notes)) {
    out.push((await readFile(notes, 'utf8')).trim());
    out.push('');
  }
  for (const [i, pair] of REFERENCE_PAIRS.entries()) {
    const a = places.resolve(pair.from);
    const b = places.resolve(pair.to);
    out.push(`## ${i + 1}. ${pair.label}`);
    out.push('');
    if (!a || !b) {
      out.push(`Lieu introuvable : ${!a ? pair.from : pair.to}.`);
      out.push('');
      continue;
    }
    const res = engine.route(a, b, 2, [0, 1, 2, 3]);
    out.push(`Départ : ${a.name} (${a.kind}, ${a.osm}) · arrivée : ${b.name} (${b.kind}, ${b.osm}).`);
    out.push('');
    if (!res.ok) {
      out.push(`Échec : ${res.error}.`);
      out.push('');
      continue;
    }
    // timing of a real request (levels 0, 2, 3) with warm cost arrays
    const t0 = performance.now();
    engine.route(a, b, 2);
    timings.push(performance.now() - t0);
    out.push(`Accrochage : départ à ${fmtM(res.from.dist)}, arrivée à ${fmtM(res.to.dist)}.`);
    out.push('');
    out.push(table([ROUTE_HEADERS, ...res.routes.map(routeRow)]));
    out.push('');
    features.push(...routesToGeoJSON(res.routes, { pair: i + 1 }).features);
    mapPairs.push({
      label: pair.label,
      from: { name: a.name, lon: a.lon, lat: a.lat },
      to: { name: b.name, lon: b.lon, lat: b.lat },
      routes: res.routes.map((r) => ({
        level: r.level.id,
        label: r.level.label,
        row: routeRow(r),
        segments: r.route.segments.map((sg) => ({ cls: sg.cls, push: sg.push, rail: sg.rail, coords: sg.coords.map(([x, y]) => [round6(x), round6(y)]) })),
      })),
    });
  }
  const avg = timings.reduce((s, t) => s + t, 0) / Math.max(1, timings.length);
  out.push('## Temps de calcul');
  out.push('');
  out.push(`Requête complète (niveaux 0, 2 et 3, accrochage compris) sur cet ordinateur : ${Math.round(avg)} ms en moyenne, ${Math.round(Math.max(...timings))} ms au pire. Budget iPhone : 500 ms.`);
  out.push('');
  out.push('## Pénalités utilisées');
  out.push('');
  out.push(table([['Niveau', 'PAVE', 'SLABS', 'LOOSE', 'UNKNOWN', 'rails ∥', 'croisement oblique'], ...LEVELS.map((l) => [`${l.id} ${l.label}`, ...[2, 1, 3, 4].map((c) => `+${l.penalties.surface[c as 0]}`), `+${l.penalties.rail}`, `${l.penalties.crossing} m`])]));
  out.push('');
  await writeFile(path.join(DOCS, 'calibration.md'), out.join('\n'));
  await writeFile(path.join(DOCS, 'calibration.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
  await writeFile(path.join(DOCS, 'calibration-map.data.js'), `window.CALIB = ${JSON.stringify({ headers: ROUTE_HEADERS, pairs: mapPairs })};\n`);
  console.log(out.join('\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
