/**
 * Phase 0, step 2: data audit (SPEC §11, phase 0).
 *
 *   pnpm data:audit
 *
 * Reads data/raw/ and writes:
 *   docs/audit.md            the report (sections 1–8 of the phase 0 checklist)
 *   docs/audit-map.data.js   data for docs/audit-map.html (generated, not committed)
 * If docs/audit-notes.md exists, it is inserted at the top of the report.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type BikeMode,
  type RoadGroup,
  SURFACE_CLASSES,
  type SurfaceClass,
  type SurfaceResult,
  type Tags,
  bikeAccess,
  classifyWaySurface,
  isArea,
  isCarriageway,
  isPresentRail,
  roadGroup,
} from '../src/core/classify.ts';
import { MILAN_PROJECTION as P } from '../src/core/geo.ts';
import { normalizeName } from '../src/core/text.ts';
import { type Edge, splitIntoEdges } from './lib/edges.ts';
import { type OsmElement, type OsmRelation, type OsmWay, readRaw, readTiles } from './lib/osm.ts';
import { RAW_DIR, readFetchLog } from './lib/overpass.ts';
import { type Perimeter, assembleRings, circlePerimeter, polygonPerimeter } from './lib/polygon.ts';
import { RailIndex, type RailInput, isRailMarked, parseLayer, railLength, sampleEdgeRails } from './lib/rails.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const D_VALUES = [3, 4, 5, 6] as const;
const HIST_MAX_M = 10;
const HIST_BIN_M = 0.5;
const DUOMO = { lon: 9.1919, lat: 45.4641 };

const CONTROL_STREETS = [
  'Via Torino', 'Via Cesare Correnti', 'Corso Magenta', 'Via Meravigli', 'Corso di Porta Romana',
  'Via De Amicis', 'Corso di Porta Ticinese', 'Via Pontaccio', 'Via Manzoni', 'Via Chiossetto',
  'Via Corridoni', 'Via Leoncavallo', 'Via Bramante', 'Via Spadari', 'Via Montegani',
];

// ---------- formatting ----------

const km = (m: number) => (m / 1000).toFixed(1);
const km2 = (m: number) => (m / 1000).toFixed(2);
const pct = (part: number, total: number) => (total > 0 ? `${((100 * part) / total).toFixed(1)} %` : '–');
const esc = (s: string) => s.replace(/\|/g, '\\|');
const osmLink = (id: number) => `[${id}](https://www.openstreetmap.org/way/${id})`;
const date = (ts?: string) => (ts ? ts.slice(0, 10) : '–');

function table(headers: string[], rows: (string | number)[][], align?: ('l' | 'r')[]): string {
  const sep = headers.map((_, i) => ((align?.[i] ?? 'l') === 'r' ? '---:' : '---'));
  return [headers, sep, ...rows.map((r) => r.map(String))].map((r) => `| ${r.join(' | ')} |`).join('\n');
}

function add<K>(m: Map<K, number>, k: K, v: number) {
  m.set(k, (m.get(k) ?? 0) + v);
}

const topEntries = <K>(m: Map<K, number>, n = Infinity) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

// ---------- geometry helpers ----------

/** Length of a way and the parts of it inside each perimeter (segment midpoint test). */
function measureWay(w: OsmWay, perims: Perimeter[]): { len: number; inside: number[] } {
  const g = w.geometry ?? [];
  let len = 0;
  const inside = perims.map(() => 0);
  for (let i = 1; i < g.length; i++) {
    const a = g[i - 1]!;
    const b = g[i]!;
    const l = Math.hypot(P.x(b.lon) - P.x(a.lon), P.y(b.lat) - P.y(a.lat));
    len += l;
    const mLon = (a.lon + b.lon) / 2;
    const mLat = (a.lat + b.lat) / 2;
    perims.forEach((p, k) => {
      if (p.contains(mLon, mLat)) inside[k]! += l;
    });
  }
  return { len, inside };
}

/** Geographic point at half the length of an edge. */
function edgeMidpoint(e: Edge): [number, number] {
  const target = e.length / 2;
  let acc = 0;
  for (let i = 1; i < e.xy.length / 2; i++) {
    const l = Math.hypot(e.xy[2 * i]! - e.xy[2 * i - 2]!, e.xy[2 * i + 1]! - e.xy[2 * i - 1]!);
    if (acc + l >= target) {
      const t = l === 0 ? 0 : (target - acc) / l;
      return [e.ll[2 * i - 2]! + t * (e.ll[2 * i]! - e.ll[2 * i - 2]!), e.ll[2 * i - 1]! + t * (e.ll[2 * i + 1]! - e.ll[2 * i - 1]!)];
    }
    acc += l;
  }
  return [e.ll[0]!, e.ll[1]!];
}

function polylineXY(coords: [number, number][]): { xy: Float64Array; length: number } {
  const xy = new Float64Array(coords.length * 2);
  let length = 0;
  coords.forEach(([lon, lat], i) => {
    xy[2 * i] = P.x(lon);
    xy[2 * i + 1] = P.y(lat);
    if (i > 0) length += Math.hypot(xy[2 * i]! - xy[2 * i - 2]!, xy[2 * i + 1]! - xy[2 * i - 1]!);
  });
  return { xy, length };
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

// ---------- street-name matching ----------

/** "Via De Amicis" matches "Via Edmondo De Amicis": same street type, same ending. */
function streetMatcher(label: string): (name: string) => boolean {
  const n = normalizeName(label);
  const i = n.indexOf(' ');
  const type = n.slice(0, i);
  const rest = n.slice(i + 1);
  return (name) => {
    const m = normalizeName(name);
    return m === n || (m.startsWith(type + ' ') && m.endsWith(' ' + rest));
  };
}

// ---------- main ----------

interface WayRec {
  w: OsmWay;
  tags: Tags;
  mode: BikeMode;
  group: RoadGroup | null;
  surf: SurfaceResult;
  area: boolean;
  len: number;
  lenCommune: number;
  lenCenter: number;
}

async function main() {
  const out: string[] = [];
  const log = (s = '') => out.push(s);

  // --- load ---
  const fetchLog = await readFetchLog();
  const bboxInfo = JSON.parse(await readFile(path.join(RAW_DIR, '_bbox.json'), 'utf8')) as Record<string, number>;
  const boundary = (await readRaw('milano-boundary')).find((e): e is OsmRelation => e.type === 'relation');
  if (!boundary) throw new Error('boundary relation missing');
  const commune = polygonPerimeter('Comune di Milano', assembleRings(boundary));
  const subareas = (await readRaw('milano-subareas')).filter((e): e is OsmRelation => e.type === 'relation');
  const m1 = subareas.find((r) => /^municipio 1$/.test(normalizeName(r.tags?.['name'] ?? '')));
  const center = m1
    ? polygonPerimeter('Municipio 1', assembleRings(m1))
    : circlePerimeter('2 km autour du Duomo', DUOMO.lon, DUOMO.lat, 2000);
  const perims = [commune, center];

  const highwayWays = (await readTiles('highways')).filter(
    (e): e is OsmWay => e.type === 'way' && !!e.geometry && !!e.tags?.['highway'],
  );
  const railWays = (await readRaw('rails')).filter((e): e is OsmWay => e.type === 'way' && !!e.geometry);
  const nodes = await readRaw('nodes');
  const addresses = await readTiles('addresses');
  console.log(`loaded ${highwayWays.length} highway ways, ${railWays.length} rail ways, ${addresses.length} address objects`);

  // --- classify ways ---
  const recs: WayRec[] = highwayWays.map((w) => {
    const tags = w.tags!;
    const { len, inside } = measureWay(w, perims);
    return {
      w,
      tags,
      mode: bikeAccess(tags),
      group: roadGroup(tags),
      surf: classifyWaySurface(tags),
      area: isArea(tags),
      len,
      lenCommune: inside[0]!,
      lenCenter: inside[1]!,
    };
  });
  const network = recs.filter((r) => r.mode !== 'excluded');
  const statWays = network.filter((r) => r.group !== null && !r.area);

  // --- header ---
  const USED = ['milano-boundary', 'milano-subareas', 'highways', 'rails', 'nodes', 'addresses'];
  const latest = new Map(fetchLog.filter((e) => USED.includes(e.name)).map((e) => [e.name, e]));
  const osmBases = [...latest.values()].map((e) => e.osmBase).filter((v): v is string => !!v).sort();
  const hosts = [...new Set([...latest.values()].map((e) => `${e.endpoint} (${[...latest.values()].filter((x) => x.endpoint === e.endpoint).map((x) => x.name).join(', ')})`))];
  log('# Audit des données OSM, Milan');
  log();
  log(`Généré par \`pnpm data:audit\` le ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Ne pas éditer à la main : les commentaires vont dans \`docs/audit-notes.md\`, inséré ci-dessous.`);
  log();
  log(`- Données OSM : état du ${osmBases[0]?.slice(0, 16).replace('T', ' ') ?? '?'} UTC${osmBases.length > 1 && osmBases[0] !== osmBases[osmBases.length - 1] ? ` au ${osmBases[osmBases.length - 1]!.slice(0, 16).replace('T', ' ')} UTC` : ''}, via ${hosts.join(' ; ')}.`);
  log(`- Zone téléchargée : bbox de la commune + ${bboxInfo['marginMeters']} m (S ${bboxInfo['south']!.toFixed(4)}, O ${bboxInfo['west']!.toFixed(4)}, N ${bboxInfo['north']!.toFixed(4)}, E ${bboxInfo['east']!.toFixed(4)}).`);
  log(`- Statistiques calculées sur deux périmètres : **${commune.label}** (relation ${boundary.id}) et **${center.label}**${m1 ? ` (relation ${m1.id})` : ' (pas de limite « Municipio 1 » trouvée dans OSM)'}. Une longueur est attribuée au périmètre qui contient le milieu de chaque segment.`);
  log(`- ${highwayWays.length.toLocaleString('fr-FR')} ways \`highway\` chargées, dont ${network.length.toLocaleString('fr-FR')} accessibles au vélo selon §6.1 (roulable ou à pied).`);
  log('- Groupes : **chaussée** = `primary` → `residential`, `living_street`, `unclassified`, `road` ; **service** = `highway=service` ; **voies douces** = `cycleway`, `path`, `track`, `pedestrian`, `footway` retenus. Les places en polygone (`area=yes`) sont exclues des longueurs.');
  log();

  const notesFile = path.join(DOCS, 'audit-notes.md');
  if (existsSync(notesFile)) {
    log((await readFile(notesFile, 'utf8')).trim());
    log();
  }

  // ===== 1 & 2. surfaces =====
  log('## 1. Revêtements');
  log();
  log('### 1a. Classes de revêtement par groupe et périmètre');
  log();
  const groups: [RoadGroup, string][] = [
    ['main', 'Chaussée'],
    ['service', 'Service'],
    ['soft', 'Voies douces'],
  ];
  const classRows: string[][] = [];
  const unknownShare: Record<string, [number, number]> = {};
  for (const [g, label] of groups) {
    for (const [k, p] of perims.entries()) {
      const byClass = new Map<SurfaceClass, number>();
      let total = 0;
      for (const r of statWays) {
        if (r.group !== g) continue;
        const l = k === 0 ? r.lenCommune : r.lenCenter;
        if (l === 0) continue;
        add(byClass, r.surf.cls, l);
        total += l;
      }
      unknownShare[`${g}/${k}`] = [byClass.get('UNKNOWN') ?? 0, total];
      classRows.push([label, p.label, km(total), ...SURFACE_CLASSES.map((c) => pct(byClass.get(c) ?? 0, total))]);
    }
  }
  log(table(['Groupe', 'Périmètre', 'km', ...SURFACE_CLASSES], classRows, ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r']));
  log();

  log('### 1b. Chaussée : longueur par valeur de `surface`');
  log();
  const byValue = new Map<string, { cls: SurfaceClass; c: number; m: number }>();
  let mainTotalC = 0;
  let mainTotalM = 0;
  for (const r of statWays) {
    if (r.group !== 'main') continue;
    const v = r.tags['surface'] ?? '(aucune)';
    const label = r.tags['surface_bike'] ? `${v} + surface_bike=${r.tags['surface_bike']}` : v;
    const e = byValue.get(label) ?? { cls: r.surf.cls, c: 0, m: 0 };
    e.c += r.lenCommune;
    e.m += r.lenCenter;
    byValue.set(label, e);
    mainTotalC += r.lenCommune;
    mainTotalM += r.lenCenter;
  }
  const valueRows = [...byValue.entries()]
    .filter(([, e]) => e.c >= 50 || e.m >= 50)
    .sort((a, b) => b[1].c - a[1].c)
    .map(([v, e]) => [`\`${esc(v)}\``, e.cls, km(e.c), pct(e.c, mainTotalC), km(e.m), pct(e.m, mainTotalM)]);
  log(table(['Valeur', 'Classe', `km ${commune.label}`, '%', `km ${center.label}`, '%'], valueRows, ['l', 'l', 'r', 'r', 'r', 'r']));
  log();
  log('Valeurs de moins de 50 m dans les deux périmètres omises (voir §8 pour les valeurs non reconnues). Une `smoothness` `good`/`excellent` sur du pavé est comptée en `SLABS` dans la colonne Classe du tableau 1a, pas ici.');
  log();

  log('## 2. Part de revêtement inconnu (`UNKNOWN`)');
  log();
  log(
    table(
      ['Groupe', commune.label, center.label],
      groups.map(([g, label]) => {
        const [uc, tc] = unknownShare[`${g}/0`]!;
        const [um, tm] = unknownShare[`${g}/1`]!;
        return [label, `${pct(uc, tc)} (${km(uc)} km)`, `${pct(um, tm)} (${km(um)} km)`];
      }),
      ['l', 'r', 'r'],
    ),
  );
  log();

  // ===== 3. tag counts =====
  log('## 3. Effectifs des tags secondaires');
  log();
  log(`Ways du réseau vélo ayant au moins un segment dans ${commune.label}.`);
  log();
  const inCommune = network.filter((r) => r.lenCommune > 0);
  const tagStats = (pred: (k: string) => boolean) => {
    const m = new Map<string, { n: number; len: number }>();
    for (const r of inCommune) {
      for (const [k, v] of Object.entries(r.tags)) {
        if (!pred(k)) continue;
        const key = `${k}=${v}`;
        const e = m.get(key) ?? { n: 0, len: 0 };
        e.n++;
        e.len += r.lenCommune;
        m.set(key, e);
      }
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  };
  const tagTable = (title: string, pred: (k: string) => boolean) => {
    const rows = tagStats(pred);
    log(`### ${title}`);
    log();
    if (rows.length === 0) log('Aucune occurrence.');
    else log(table(['Tag', 'Ways', 'km'], rows.slice(0, 25).map(([k, e]) => [`\`${esc(k)}\``, e.n, km(e.len)]), ['l', 'r', 'r']));
    if (rows.length > 25) log(`\n… et ${rows.length - 25} autres combinaisons.`);
    log();
  };
  tagTable('`smoothness`', (k) => k === 'smoothness');
  tagTable('`surface_bike`', (k) => k === 'surface_bike');
  tagTable('`embedded_rails`', (k) => k === 'embedded_rails');
  tagTable('`cycleway:*:surface`', (k) => /^cycleway(:(left|right|both))?:surface$/.test(k));
  tagTable('`cycling_width` (schéma local, souvent associé à `surface_bike`)', (k) => k === 'cycling_width');

  // ===== 4. rails =====
  log('## 4. Rails de tram');
  log();
  const railKind = (t: Tags) =>
    t['railway'] === 'tram'
      ? 'railway=tram'
      : t['railway'] === 'disused' || t['disused:railway'] === 'tram'
        ? `désaffecté (${t['railway'] ?? '–'}, disused:railway=${t['disused:railway'] ?? '–'})`
        : t['railway'] === 'construction'
          ? `construction (${t['construction'] ?? '–'})`
          : `autre (${t['railway'] ?? '–'})`;
  const kindLen = new Map<string, number>();
  for (const w of railWays) add(kindLen, railKind(w.tags ?? {}), measureWay(w, [commune]).inside[0]!);
  log(`### 4a. Longueur de voies dans ${commune.label}`);
  log();
  log('Chaque voie d\'une ligne à double voie est une way distincte : 1 km de ligne ≈ 2 km de voies.');
  log();
  log(table(['Type', 'km de voies'], topEntries(kindLen).map(([k, v]) => [esc(k), km(v)]), ['l', 'r']));
  log();

  const presentRails = railWays.filter((w) => isPresentRail(w.tags ?? {}));
  const keyFreq = new Map<string, Map<string, number>>();
  for (const w of presentRails) {
    for (const [k, v] of Object.entries(w.tags ?? {})) {
      if (/^(name|ref|operator|wikidata|wikipedia|source|note|fixme)(:|$)/.test(k)) continue;
      let m = keyFreq.get(k);
      if (!m) keyFreq.set(k, (m = new Map()));
      add(m, v, 1);
    }
  }
  log('### 4b. Tags portés par les rails présents');
  log();
  log('Pour repérer un tag qui distinguerait rails noyés et site propre (`embedded`, `segregated`, etc.).');
  log();
  log(
    table(
      ['Clé', 'Ways', 'Valeurs principales'],
      [...keyFreq.entries()]
        .map(([k, m]) => [k, [...m.values()].reduce((a, b) => a + b, 0), m] as const)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([k, n, m]) => [`\`${k}\``, n, topEntries(m, 4).map(([v, c]) => `${esc(v)} (${c})`).join(', ')]),
      ['l', 'r', 'l'],
    ),
  );
  log();

  // network graph edges and spatial detection
  const networkWays = network.map((r) => r.w);
  const netRecs = network;
  const edges = splitIntoEdges(networkWays);
  const railIndex = new RailIndex(
    presentRails.map((w): RailInput => ({ coords: w.geometry!.map((g) => [g.lon, g.lat]), layer: parseLayer(w.tags?.['layer']) })),
    HIST_MAX_M,
  );
  const nBins = HIST_MAX_M / HIST_BIN_M;
  const histRoad = new Float64Array(nBins);
  const wayRail = new Map<number, number[]>(); // way index → effective railLen per D (marked edges only)
  const edgeInfo = new Map<Edge, { md: number; rl: number[] }>();
  const detect = D_VALUES.map(() => ({ edges: 0, lenC: 0, lenM: 0, railC: 0, lenEmbedded: 0, lenOther: 0 }));
  let embeddedTotal = 0;
  const cwEdges = edges.filter((e) => {
    const r = netRecs[e.wayIdx]!;
    return isCarriageway(r.tags) && !r.area;
  });
  for (const e of cwEdges) {
    const r = netRecs[e.wayIdx]!;
    const s = sampleEdgeRails(e.xy, e.length, railIndex, parseLayer(r.tags['layer']));
    const rl = D_VALUES.map((D) => railLength(s, D));
    const marked = rl.map((l) => isRailMarked(l, e.length));
    const [mLon, mLat] = edgeMidpoint(e);
    const inC = commune.contains(mLon, mLat);
    const inM = center.contains(mLon, mLat);
    const embedded = !!r.tags['embedded_rails'] && r.tags['embedded_rails'] !== 'no';
    if (embedded && inC) embeddedTotal += e.length;
    const firstMarked = marked.indexOf(true);
    edgeInfo.set(e, { md: firstMarked < 0 ? 0 : D_VALUES[firstMarked]!, rl });
    let wr = wayRail.get(e.wayIdx);
    if (!wr) wayRail.set(e.wayIdx, (wr = D_VALUES.map(() => 0)));
    marked.forEach((m, i) => {
      if (!m) return;
      wr[i]! += rl[i]!;
      if (!inC) return;
      const d = detect[i]!;
      d.edges++;
      d.lenC += e.length;
      d.railC += rl[i]!;
      if (inM) d.lenM += e.length;
      if (embedded) d.lenEmbedded += e.length;
      else d.lenOther += e.length;
    });
    if (inC) for (const d of s.dist) if (d < HIST_MAX_M) histRoad[Math.floor(d / HIST_BIN_M)]! += s.pieceLen;
  }

  // reverse view: how much tram track lies within D of a carriageway centreline
  const roadIndex = new RailIndex(
    cwEdges.map((e): RailInput => {
      const coords: [number, number][] = [];
      for (let i = 0; i < e.ll.length; i += 2) coords.push([e.ll[i]!, e.ll[i + 1]!]);
      return { coords, layer: parseLayer(netRecs[e.wayIdx]!.tags['layer']) };
    }),
    HIST_MAX_M,
  );
  const histRail = new Float64Array(nBins);
  const coverage = D_VALUES.map(() => 0);
  let tramTrackC = 0;
  for (const w of presentRails) {
    if (w.tags?.['railway'] !== 'tram') continue;
    const { xy, length } = polylineXY(w.geometry!.map((g) => [g.lon, g.lat]));
    if (length === 0) continue;
    const s = sampleEdgeRails(xy, length, roadIndex, parseLayer(w.tags?.['layer']));
    // attribute to the commune by the way's own midpoint share
    const share = measureWay(w, [commune]).inside[0]! / length;
    tramTrackC += length * share;
    D_VALUES.forEach((D, i) => (coverage[i]! += railLength(s, D) * share));
    for (const d of s.dist) if (d < HIST_MAX_M) histRail[Math.floor(d / HIST_BIN_M)]! += s.pieceLen * share;
  }

  log('### 4c. Chaussée marquée « sur rails » selon D');
  log();
  log(`Échantillon tous les 10 m sur ${cwEdges.length.toLocaleString('fr-FR')} arêtes de chaussée (y compris \`service\` et \`pedestrian\`), rail parallèle à ±20°, même \`layer\`. Arête marquée si \`railLen\` ≥ 30 m ou ≥ 30 % de sa longueur. Longueurs dans ${commune.label} (milieu d'arête).`);
  log();
  log(
    table(
      ['D', 'Arêtes marquées', 'km chaussée marquée', `dont ${center.label}`, 'km railLen cumulé', '% voies tram à ≤ D d\'une chaussée', 'Rappel sur ways `embedded_rails`', 'km marqués hors `embedded_rails`'],
      D_VALUES.map((D, i) => {
        const d = detect[i]!;
        return [
          `${D} m`,
          d.edges.toLocaleString('fr-FR'),
          km(d.lenC),
          km(d.lenM),
          km(d.railC),
          pct(coverage[i]!, tramTrackC),
          embeddedTotal > 0 ? pct(d.lenEmbedded, embeddedTotal) : 'n/a',
          km(d.lenOther),
        ];
      }),
      ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    ),
  );
  log();
  log(`Voies \`railway=tram\` dans la commune : ${km(tramTrackC)} km. Longueur de chaussée portant \`embedded_rails\` : ${km2(embeddedTotal)} km.`);
  log();
  // streets whose marking depends on D: the ones to eyeball on the map
  const byStreet = (pred: (md: number) => boolean) => {
    const m = new Map<string, number>();
    for (const e of cwEdges) {
      const info = edgeInfo.get(e);
      if (!info || !pred(info.md)) continue;
      const [lo, la] = edgeMidpoint(e);
      if (!commune.contains(lo, la)) continue;
      add(m, netRecs[e.wayIdx]!.tags['name'] ?? '(sans nom)', e.length);
    }
    return topEntries(m, 15).map(([n, l]) => `${esc(n)} (${Math.round(l)} m)`).join(', ');
  };
  log(`Rues marquées seulement à D ≥ 4 m, à vérifier sur la carte : ${byStreet((md) => md >= 4)}.`);
  log();
  log(`Rues les plus longuement marquées dès D = 3 m : ${byStreet((md) => md === 3)}.`);
  log();
  log('### 4d. Distribution des distances rail ↔ axe de chaussée');
  log();
  log('Distance au plus proche rail parallèle, pondérée par la longueur. Colonne 1 : échantillons de chaussée. Colonne 2 : échantillons de voies tram vers la chaussée la plus proche. Un pic net sous 2–3 m signale des rails dessinés dans l\'axe de la rue ; une seconde bosse vers 5–9 m signale plutôt des voies en site propre ou des chaussées séparées.');
  log();
  log(
    table(
      ['Distance', 'km de chaussée', 'km de voies tram'],
      [...histRoad].map((v, i) => [`${(i * HIST_BIN_M).toFixed(1)}–${((i + 1) * HIST_BIN_M).toFixed(1)} m`, km2(v), km2(histRail[i]!)]),
      ['l', 'r', 'r'],
    ),
  );
  log();
  const crossings = nodes.filter((n) => n.type === 'node' && /^(tram_level_crossing|tram_crossing)$/.test(n.tags?.['railway'] ?? ''));
  log(`Nœuds \`railway=tram_level_crossing\` / \`tram_crossing\` dans la zone : ${crossings.length}.`);
  log();

  // ===== 5. control streets =====
  log('## 5. Contrôle rue par rue');
  log();
  log(`Chaussées et pistes cyclables portant le nom, dans ${commune.label} (les homonymes des communes voisines sont écartés). « Rails » = longueur effective sur rails des arêtes marquées, pour D = 3 / 4 / 5 / 6 m. Aucune way milanaise ne porte \`embedded_rails\`.`);
  log();
  const recIndex = new Map(netRecs.map((r, i) => [r, i]));
  const streetBounds: Record<string, [number, number, number, number]> = {};
  for (const label of CONTROL_STREETS) {
    const match = streetMatcher(label);
    const rows = recs.filter(
      (r) =>
        r.tags['name'] &&
        match(r.tags['name']) &&
        !r.area &&
        r.lenCommune >= 0.5 * r.len &&
        (isCarriageway(r.tags) || r.tags['highway'] === 'cycleway'),
    );
    log(`### ${label}`);
    log();
    if (rows.length === 0) {
      log('Aucune way trouvée sous ce nom.');
      log();
      continue;
    }
    const names = [...new Set(rows.map((r) => r.tags['name']!))];
    const byCls = new Map<SurfaceClass, number>();
    let total = 0;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const r of rows) {
      if (r.tags['highway'] !== 'cycleway') {
        add(byCls, r.surf.cls, r.len);
        total += r.len;
      }
      for (const g of r.w.geometry!) {
        minLon = Math.min(minLon, g.lon); maxLon = Math.max(maxLon, g.lon);
        minLat = Math.min(minLat, g.lat); maxLat = Math.max(maxLat, g.lat);
      }
    }
    streetBounds[label] = [minLon, minLat, maxLon, maxLat];
    const ewAxis = (maxLon - minLon) * P.kx > (maxLat - minLat) * P.ky;
    rows.sort((a, b) => (ewAxis ? a.w.geometry![0]!.lon - b.w.geometry![0]!.lon : b.w.geometry![0]!.lat - a.w.geometry![0]!.lat));
    log(`Noms OSM : ${names.map((n) => `« ${n} »`).join(', ')}. Chaussée : ${km2(total)} km, ${SURFACE_CLASSES.filter((c) => byCls.get(c)).map((c) => `${c} ${pct(byCls.get(c)!, total)}`).join(', ')}.`);
    log();
    log(
      table(
        ['Way', 'highway', 'surface', 'surface_bike', 'smoothness', 'Classe', 'm', 'Rails (m)', 'Modif. OSM'],
        rows.map((r) => {
          const i = recIndex.get(r);
          const wr = i === undefined ? undefined : wayRail.get(i);
          return [
            osmLink(r.w.id),
            r.tags['highway']!,
            esc(r.tags['surface'] ?? '–'),
            esc(r.tags['surface_bike'] ?? '–'),
            r.tags['smoothness'] ?? '–',
            r.surf.cls,
            Math.round(r.len),
            r.mode === 'excluded' ? 'hors réseau vélo' : wr ? wr.map((v) => Math.round(v)).join(' / ') : '–',
            date(r.w.timestamp),
          ];
        }),
        ['l', 'l', 'l', 'l', 'l', 'l', 'r', 'r', 'l'],
      ),
    );
    log();
  }

  // ===== 6. SLABS streets =====
  log('## 6. Les 40 plus longues rues classées `SLABS`');
  log();
  log(`Chaussées nommées (y compris \`service\` et \`pedestrian\`), longueur \`SLABS\` dans ${commune.label}. Sert à décider si \`paving_stones\` désigne à Milan des dalles roulantes ou du pavé.`);
  log();
  interface StreetAgg { name: string; slabs: number; slabsCenter: number; pave: number; total: number; values: Map<string, number>; highways: Map<string, number>; smooth: Map<string, number>; latest: string }
  const surfaceLabel = (t: Tags) => (t['surface'] ?? '–') + (t['surface_bike'] ? ` + surface_bike=${t['surface_bike']}` : '');
  const streets = new Map<string, StreetAgg>();
  for (const r of statWays) {
    const name = r.tags['name'];
    if (!name || !isCarriageway(r.tags) || r.lenCommune === 0) continue;
    const key = normalizeName(name);
    let a = streets.get(key);
    if (!a) streets.set(key, (a = { name, slabs: 0, slabsCenter: 0, pave: 0, total: 0, values: new Map(), highways: new Map(), smooth: new Map(), latest: '' }));
    a.total += r.lenCommune;
    if (r.surf.cls === 'PAVE') a.pave += r.lenCommune;
    if (r.surf.cls === 'SLABS') {
      a.slabs += r.lenCommune;
      a.slabsCenter += r.lenCenter;
      add(a.values, surfaceLabel(r.tags), r.lenCommune);
      add(a.highways, r.tags['highway']!, r.lenCommune);
      if (r.tags['smoothness']) add(a.smooth, r.tags['smoothness'], r.lenCommune);
      if ((r.w.timestamp ?? '') > a.latest) a.latest = r.w.timestamp ?? '';
    }
  }
  const slabsTop = [...streets.values()].filter((a) => a.slabs > 0).sort((a, b) => b.slabs - a.slabs).slice(0, 40);
  log(
    table(
      ['#', 'Rue', 'm SLABS', `dont ${center.label}`, '% de la rue', 'Valeurs', 'highway', 'smoothness', 'm PAVE ailleurs sur la rue', 'Modif. la plus récente'],
      slabsTop.map((a, i) => [
        i + 1,
        esc(a.name),
        Math.round(a.slabs),
        Math.round(a.slabsCenter),
        pct(a.slabs, a.total),
        topEntries(a.values, 3).map(([v]) => esc(v)).join(', '),
        topEntries(a.highways, 2).map(([v]) => v).join(', '),
        topEntries(a.smooth, 2).map(([v]) => v).join(', ') || '–',
        Math.round(a.pave),
        date(a.latest),
      ]),
      ['r', 'l', 'r', 'r', 'r', 'l', 'l', 'l', 'r', 'l'],
    ),
  );
  log();
  const slabsTotal = statWays.filter((r) => r.surf.cls === 'SLABS' && r.group === 'main').reduce((s, r) => s + r.lenCommune, 0);
  log(`Total \`SLABS\` sur la chaussée de la commune : ${km(slabsTotal)} km.`);
  log();

  // ===== 7. addresses =====
  log('## 7. Adresses');
  log();
  const addrIn = (addresses as OsmElement[]).filter((e) => {
    if (!e.tags?.['addr:housenumber']) return false;
    const c = e.type === 'node' ? e : e.center;
    return !!c && commune.contains(c.lon, c.lat);
  });
  const withStreet = addrIn.filter((e) => e.tags!['addr:street']);
  const withPlace = addrIn.filter((e) => !e.tags!['addr:street'] && e.tags!['addr:place']);
  const addrStreets = new Set(withStreet.map((e) => normalizeName(e.tags!['addr:street']!)));
  const named = new Map<string, { name: string; len: number }>();
  for (const r of statWays) {
    const name = r.tags['name'];
    if (!name || !isCarriageway(r.tags) || r.lenCommune === 0) continue;
    const k = normalizeName(name);
    const e = named.get(k) ?? { name, len: 0 };
    e.len += r.lenCommune;
    named.set(k, e);
  }
  const namedArr = [...named.entries()];
  const covered = namedArr.filter(([k]) => addrStreets.has(k));
  const namedLen = namedArr.reduce((s, [, e]) => s + e.len, 0);
  const coveredLen = covered.reduce((s, [, e]) => s + e.len, 0);
  const byType = new Map<string, number>();
  for (const e of addrIn) add(byType, e.type, 1);
  log(
    table(
      ['Mesure', 'Valeur'],
      [
        ['Objets avec `addr:housenumber`', `${addrIn.length.toLocaleString('fr-FR')} (${topEntries(byType).map(([t, n]) => `${t} ${n.toLocaleString('fr-FR')}`).join(', ')})`],
        ['… avec `addr:street`', `${withStreet.length.toLocaleString('fr-FR')} (${pct(withStreet.length, addrIn.length)})`],
        ['… avec `addr:place` seulement', withPlace.length.toLocaleString('fr-FR')],
        ['Couples rue + numéro distincts', new Set(withStreet.map((e) => `${normalizeName(e.tags!['addr:street']!)}|${e.tags!['addr:housenumber']}`)).size.toLocaleString('fr-FR')],
        ['Rues nommées (chaussée)', namedArr.length.toLocaleString('fr-FR')],
        ['… ayant au moins un numéro', `${covered.length.toLocaleString('fr-FR')} (${pct(covered.length, namedArr.length)})`],
        ['… en longueur', `${km(coveredLen)} km sur ${km(namedLen)} km (${pct(coveredLen, namedLen)})`],
      ],
      ['l', 'l'],
    ),
  );
  log();
  const uncovered = namedArr.filter(([k]) => !addrStreets.has(k)).sort((a, b) => b[1].len - a[1].len).slice(0, 15);
  log(`Plus longues rues nommées sans aucun numéro : ${uncovered.map(([, e]) => `${esc(e.name)} (${km(e.len)} km)`).join(', ')}.`);
  log();

  // ===== 8. unrecognized surfaces =====
  log('## 8. Valeurs de `surface` non reconnues');
  log();
  const unknownVals = new Map<string, { n: number; len: number; ids: number[] }>();
  for (const r of network) {
    if (r.surf.recognized || r.lenCommune === 0) continue;
    const v = r.tags['surface']!;
    const e = unknownVals.get(v) ?? { n: 0, len: 0, ids: [] };
    e.n++;
    e.len += r.lenCommune;
    if (e.ids.length < 3) e.ids.push(r.w.id);
    unknownVals.set(v, e);
  }
  if (unknownVals.size === 0) log('Aucune.');
  else {
    log('Classées `UNKNOWN` en attendant une décision. Réseau vélo entier (tous groupes), dans la commune.');
    log();
    log(
      table(
        ['Valeur', 'Ways', 'km', 'Exemples'],
        [...unknownVals.entries()].sort((a, b) => b[1].len - a[1].len).map(([v, e]) => [`\`${esc(v)}\``, e.n, km2(e.len), e.ids.map(osmLink).join(', ')]),
        ['l', 'r', 'r', 'l'],
      ),
    );
    for (const [v, e] of unknownVals) console.warn(`unrecognized surface "${v}": ${e.n} ways`);
  }
  log();

  await writeFile(path.join(DOCS, 'audit.md'), out.join('\n'));
  console.log('wrote docs/audit.md');

  // ===== map data =====
  const mapWays: (string | number)[][] = [];
  const mapWayIdx = new Map<number, number>();
  const clsIdx = (c: SurfaceClass) => SURFACE_CLASSES.indexOf(c);
  const mapEdges: unknown[] = [];
  for (const e of edges) {
    const r = netRecs[e.wayIdx]!;
    const showable = isCarriageway(r.tags) || (r.mode === 'ride' && r.group === 'soft');
    if (!showable) continue;
    let wi = mapWayIdx.get(e.wayIdx);
    if (wi === undefined) {
      wi = mapWays.length;
      mapWayIdx.set(e.wayIdx, wi);
      const t = r.tags;
      const cw = Object.entries(t).filter(([k]) => /^cycleway(:(left|right|both))?:surface$/.test(k)).map(([k, v]) => `${k}=${v}`).join('; ');
      mapWays.push([r.w.id, t['name'] ?? '', t['highway']!, t['surface'] ?? '', t['smoothness'] ?? '', date(r.w.timestamp), t['embedded_rails'] ?? '', t['surface_bike'] ?? '', cw, r.mode, r.area ? 1 : 0]);
    }
    const info = edgeInfo.get(e);
    const coords: number[] = [];
    for (const v of e.ll) coords.push(round6(v));
    mapEdges.push([wi, clsIdx(r.surf.cls), info?.md ?? 0, info ? info.rl.map((v) => Math.round(v)) : [], coords]);
  }
  const mapRails = presentRails
    .concat(railWays.filter((w) => w.tags?.['railway'] === 'construction'))
    .map((w) => [w.id, railKind(w.tags ?? {}), w.tags?.['layer'] ?? '', date(w.timestamp), w.geometry!.flatMap((g) => [round6(g.lon), round6(g.lat)])]);
  const data = {
    generated: new Date().toISOString(),
    osmBase: osmBases[0] ?? null,
    classes: SURFACE_CLASSES,
    dValues: D_VALUES,
    commune: commune.geometry,
    center: { label: center.label, geometry: center.geometry },
    ways: mapWays,
    edges: mapEdges,
    rails: mapRails,
    streets: {
      control: streetBounds,
      slabs: Object.fromEntries(
        slabsTop.map((a) => {
          const k = normalizeName(a.name);
          let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
          for (const r of statWays) {
            if (!r.tags['name'] || normalizeName(r.tags['name']) !== k) continue;
            for (const g of r.w.geometry!) b = [Math.min(b[0], g.lon), Math.min(b[1], g.lat), Math.max(b[2], g.lon), Math.max(b[3], g.lat)];
          }
          return [a.name, b];
        }),
      ),
    },
  };
  const js = `window.AUDIT = ${JSON.stringify(data)};\n`;
  await writeFile(path.join(DOCS, 'audit-map.data.js'), js);
  console.log(`wrote docs/audit-map.data.js (${(js.length / 1e6).toFixed(1)} MB, ${mapEdges.length} edges)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
