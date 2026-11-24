/**
 * Offline geocoder (SPEC §6.4, §9.1): binary index of streets (with house numbers) and named places,
 * and the search used by the routing worker. Pure TypeScript.
 *
 * Matching is token based: every query word must match a word of a key exactly, as a prefix, or within
 * one or two typos. Keys include the name without its street type ("torino" for "Via Torino"),
 * day numbers in three forms ("24 maggio", "ventiquattro maggio", "xxiv maggio") and aliases.
 */
import { editDistance, searchKey } from './text.ts';

export const GEOCODER_MAGIC = 0x4d4c4743; // "MLGC"
export const GEOCODER_VERSION = 1;
const SCALE = 1e7;

export const KIND_STREET = 0;
export const KIND_PLACE = 1;

export interface GeocoderArrays {
  strBytes: Uint8Array;
  strOffsets: Uint32Array;
  entryKind: Uint8Array;
  entryName: Uint32Array;
  entrySub: Uint32Array;
  entryLon: Int32Array;
  entryLat: Int32Array;
  entryWeight: Float32Array;
  /** House numbers of entry e: entryNumStart[e] .. entryNumStart[e+1]-1 */
  entryNumStart: Uint32Array;
  numStr: Uint32Array;
  numLon: Int32Array;
  numLat: Int32Array;
  keyEntry: Uint32Array;
  keyStr: Uint32Array;
}

export interface GeocoderHeader {
  version: number;
  builtAt: string;
  osmBase: string | null;
  counts: { entries: number; numbers: number; keys: number; strings: number };
  arrays: Record<string, { offset: number; length: number; type: string }>;
}

const TYPES: Record<keyof GeocoderArrays, 'Uint8' | 'Uint32' | 'Int32' | 'Float32'> = {
  strBytes: 'Uint8',
  strOffsets: 'Uint32',
  entryKind: 'Uint8',
  entryName: 'Uint32',
  entrySub: 'Uint32',
  entryLon: 'Int32',
  entryLat: 'Int32',
  entryWeight: 'Float32',
  entryNumStart: 'Uint32',
  numStr: 'Uint32',
  numLon: 'Int32',
  numLat: 'Int32',
  keyEntry: 'Uint32',
  keyStr: 'Uint32',
};
const CTORS = { Uint8: Uint8Array, Uint32: Uint32Array, Int32: Int32Array, Float32: Float32Array } as const;
const align8 = (n: number) => (n + 7) & ~7;

// ---------- writer (build time) ----------

export interface GeoEntryInput {
  kind: number;
  name: string;
  sub: string;
  lon: number;
  lat: number;
  weight: number;
  keys: string[];
  numbers: { n: string; lon: number; lat: number }[];
}

export function serializeGeocoder(entries: GeoEntryInput[], meta: { builtAt: string; osmBase: string | null }): Uint8Array {
  const strings: string[] = [];
  const strIndex = new Map<string, number>();
  const str = (s: string) => {
    let i = strIndex.get(s);
    if (i === undefined) {
      i = strings.length;
      strIndex.set(s, i);
      strings.push(s);
    }
    return i;
  };
  const E = entries.length;
  const a = {
    entryKind: new Uint8Array(E),
    entryName: new Uint32Array(E),
    entrySub: new Uint32Array(E),
    entryLon: new Int32Array(E),
    entryLat: new Int32Array(E),
    entryWeight: new Float32Array(E),
    entryNumStart: new Uint32Array(E + 1),
  };
  const numStr: number[] = [];
  const numLon: number[] = [];
  const numLat: number[] = [];
  const keyEntry: number[] = [];
  const keyStr: number[] = [];
  entries.forEach((e, i) => {
    a.entryKind[i] = e.kind;
    a.entryName[i] = str(e.name);
    a.entrySub[i] = str(e.sub);
    a.entryLon[i] = Math.round(e.lon * SCALE);
    a.entryLat[i] = Math.round(e.lat * SCALE);
    a.entryWeight[i] = e.weight;
    a.entryNumStart[i] = numStr.length;
    for (const n of e.numbers) {
      numStr.push(str(n.n));
      numLon.push(Math.round(n.lon * SCALE));
      numLat.push(Math.round(n.lat * SCALE));
    }
    for (const k of new Set(e.keys)) {
      keyEntry.push(i);
      keyStr.push(str(k));
    }
  });
  a.entryNumStart[E] = numStr.length;
  const enc = new TextEncoder();
  const encoded = strings.map((s) => enc.encode(s));
  const strOffsets = new Uint32Array(strings.length + 1);
  let total = 0;
  encoded.forEach((b, i) => {
    strOffsets[i] = total;
    total += b.length;
  });
  strOffsets[strings.length] = total;
  const strBytes = new Uint8Array(total);
  encoded.forEach((b, i) => strBytes.set(b, strOffsets[i]!));

  const arrays: GeocoderArrays = {
    strBytes,
    strOffsets,
    ...a,
    numStr: Uint32Array.from(numStr),
    numLon: Int32Array.from(numLon),
    numLat: Int32Array.from(numLat),
    keyEntry: Uint32Array.from(keyEntry),
    keyStr: Uint32Array.from(keyStr),
  };
  const layout: GeocoderHeader['arrays'] = {};
  let offset = 0;
  for (const name of Object.keys(TYPES) as (keyof GeocoderArrays)[]) {
    layout[name] = { offset, length: arrays[name].length, type: TYPES[name] };
    offset = align8(offset + arrays[name].byteLength);
  }
  const header: GeocoderHeader = {
    version: GEOCODER_VERSION,
    ...meta,
    counts: { entries: E, numbers: numStr.length, keys: keyEntry.length, strings: strings.length },
    arrays: layout,
  };
  const json = enc.encode(JSON.stringify(header));
  const dataStart = align8(12 + json.length);
  const out = new Uint8Array(dataStart + offset);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, GEOCODER_MAGIC, true);
  dv.setUint32(4, GEOCODER_VERSION, true);
  dv.setUint32(8, json.length, true);
  out.set(json, 12);
  for (const name of Object.keys(TYPES) as (keyof GeocoderArrays)[]) {
    const arr = arrays[name];
    out.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), dataStart + layout[name]!.offset);
  }
  return out;
}

// ---------- reader and search ----------

export type GeoResultKind = 'street' | 'address' | 'place' | 'coords';

export interface GeoResult {
  kind: GeoResultKind;
  label: string;
  sublabel: string;
  lon: number;
  lat: number;
  /** House number not found exactly: the point is the nearest known number or the street. */
  approximate?: boolean;
  score: number;
}

const COORDS_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export function parseCoords(q: string): { lat: number; lon: number } | null {
  const m = q.match(COORDS_RE);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** "via torino 12" → text "via torino", number "12"; "torino, 12b" → "torino", "12b". */
export function splitHouseNumber(key: string): { text: string; number: string | null } {
  const m = key.match(/^(.*\D)\s+(\d{1,4}\s?[a-z]{0,3})$/);
  if (!m || !m[1]!.trim()) return { text: key, number: null };
  return { text: m[1]!.trim(), number: m[2]!.replace(/\s/g, '') };
}

const houseValue = (s: string) => Number.parseInt(s, 10);

export class Geocoder {
  readonly header: GeocoderHeader;
  private readonly a: GeocoderArrays;
  private readonly decoder = new TextDecoder();
  private readonly cache = new Map<number, string>();
  private readonly keys: { entry: number; tokens: string[]; full: string }[] = [];

  constructor(buffer: ArrayBuffer) {
    const dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== GEOCODER_MAGIC) throw new Error('not a Milano Liscio geocoder file');
    const version = dv.getUint32(4, true);
    if (version !== GEOCODER_VERSION) throw new Error(`geocoder version ${version}, expected ${GEOCODER_VERSION}`);
    const jsonLen = dv.getUint32(8, true);
    this.header = JSON.parse(this.decoder.decode(new Uint8Array(buffer, 12, jsonLen))) as GeocoderHeader;
    const dataStart = align8(12 + jsonLen);
    const arrays = {} as Record<string, unknown>;
    for (const [name, { offset, length, type }] of Object.entries(this.header.arrays)) {
      arrays[name] = new CTORS[type as keyof typeof CTORS](buffer, dataStart + offset, length);
    }
    this.a = arrays as unknown as GeocoderArrays;
    for (let k = 0; k < this.a.keyEntry.length; k++) {
      const full = this.str(this.a.keyStr[k]!);
      this.keys.push({ entry: this.a.keyEntry[k]!, tokens: full.split(' '), full });
    }
  }

  private str(i: number): string {
    let s = this.cache.get(i);
    if (s === undefined) {
      s = this.decoder.decode(this.a.strBytes.subarray(this.a.strOffsets[i]!, this.a.strOffsets[i + 1]!));
      this.cache.set(i, s);
    }
    return s;
  }

  get entryCount(): number {
    return this.a.entryKind.length;
  }

  /**
   * Score of one key against the query tokens, or -1 when a query word has no match.
   * `fuzzy` allows typos (one, or two for words of 8+ letters); it is only tried when exact and prefix
   * matching found too little, which keeps typing fast.
   */
  private scoreKey(q: string[], key: { tokens: string[]; full: string }, qFull: string, fuzzy: boolean): number {
    const used = new Uint8Array(key.tokens.length);
    let total = 0;
    let firstAligned = false;
    for (let i = 0; i < q.length; i++) {
      const qt = q[i]!;
      const last = i === q.length - 1;
      let best = 0;
      let bestJ = -1;
      for (let j = 0; j < key.tokens.length; j++) {
        if (used[j]) continue;
        const kt = key.tokens[j]!;
        let s = 0;
        if (kt === qt) s = 1;
        else if (kt.startsWith(qt) && (qt.length >= 2 || last)) s = 0.8;
        else if (fuzzy && qt.length >= 4) {
          const maxD = qt.length >= 8 ? 2 : 1;
          // editDistance returns maxD + 1 when the words are further apart than maxD
          const d = editDistance(qt, kt, maxD);
          if (d === 1) s = 0.6;
          else if (d === 2 && maxD === 2) s = 0.45;
          else if (last && kt.length > qt.length && editDistance(qt, kt.slice(0, qt.length), 1) === 1) s = 0.5;
        }
        if (s > best) {
          best = s;
          bestJ = j;
        }
      }
      if (bestJ < 0) return -1;
      used[bestJ] = 1;
      total += best;
      if (i === 0 && bestJ === 0) firstAligned = true;
    }
    let score = (10 * total) / q.length - 0.3 * (key.tokens.length - q.length);
    if (key.full === qFull) score += 2;
    else if (key.full.startsWith(qFull)) score += 1;
    if (firstAligned) score += 0.5;
    return score;
  }

  private matchEntries(text: string, limit: number): { entry: number; score: number }[] {
    const q = text.split(' ').filter(Boolean);
    if (q.length === 0) return [];
    const best = new Map<number, number>();
    for (const fuzzy of [false, true]) {
      for (const key of this.keys) {
        const s = this.scoreKey(q, key, text, fuzzy);
        if (s < 0) continue;
        const prev = best.get(key.entry);
        if (prev === undefined || s > prev) best.set(key.entry, s);
      }
      if (best.size >= limit) break;
    }
    return [...best.entries()]
      .map(([entry, s]) => ({ entry, score: s + this.a.entryWeight[entry]! }))
      .sort((x, y) => y.score - x.score)
      .slice(0, limit * 3);
  }

  private result(entry: number, score: number): GeoResult {
    return {
      kind: this.a.entryKind[entry] === KIND_STREET ? 'street' : 'place',
      label: this.str(this.a.entryName[entry]!),
      sublabel: this.str(this.a.entrySub[entry]!),
      lon: this.a.entryLon[entry]! / SCALE,
      lat: this.a.entryLat[entry]! / SCALE,
      score,
    };
  }

  /** House number on a street: exact, else nearest known number on the same side (same parity). */
  private address(entry: number, number: string, score: number): GeoResult {
    const base = this.result(entry, score);
    const from = this.a.entryNumStart[entry]!;
    const to = this.a.entryNumStart[entry + 1]!;
    const label = `${base.label} ${number.toUpperCase()}`;
    if (from === to) return { ...base, kind: 'address', label, sublabel: `${base.sublabel} · numéro inconnu, milieu de la rue`, approximate: true };
    const want = number.toLowerCase();
    const wantValue = houseValue(want);
    let nearest = -1;
    let nearestGap = Infinity;
    for (let i = from; i < to; i++) {
      const n = this.str(this.a.numStr[i]!).toLowerCase().replace(/\s/g, '');
      const point = { lon: this.a.numLon[i]! / SCALE, lat: this.a.numLat[i]! / SCALE };
      if (n === want) return { ...base, ...point, kind: 'address', label };
      const v = houseValue(n);
      if (!Number.isFinite(v) || (v - wantValue) % 2 !== 0) continue;
      const gap = Math.abs(v - wantValue);
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = i;
      }
    }
    if (nearest < 0) return { ...base, kind: 'address', label, sublabel: `${base.sublabel} · numéro inconnu, milieu de la rue`, approximate: true };
    return {
      ...base,
      lon: this.a.numLon[nearest]! / SCALE,
      lat: this.a.numLat[nearest]! / SCALE,
      kind: 'address',
      label,
      sublabel: `${base.sublabel} · ≈ n° ${this.str(this.a.numStr[nearest]!)}`,
      approximate: true,
    };
  }

  search(query: string, limit = 8): GeoResult[] {
    const coords = parseCoords(query);
    if (coords) return [{ kind: 'coords', label: `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`, sublabel: 'Coordonnées', ...coords, score: 100 }];
    const key = searchKey(query);
    if (!key) return [];
    const { text, number } = splitHouseNumber(key);
    let matches = this.matchEntries(text, limit);
    let results: GeoResult[];
    if (number && matches.some((m) => this.a.entryKind[m.entry] === KIND_STREET)) {
      results = matches.filter((m) => this.a.entryKind[m.entry] === KIND_STREET).map((m) => this.address(m.entry, number, m.score));
    } else {
      if (number) matches = this.matchEntries(key, limit); // the number may belong to the name
      results = matches.map((m) => this.result(m.entry, m.score));
    }
    // Drop near-duplicates (same label within 200 m, e.g. a square mapped as street and as place).
    const kept: GeoResult[] = [];
    for (const r of results) {
      const dup = kept.some((k) => k.label === r.label && Math.abs(k.lat - r.lat) < 0.0018 && Math.abs(k.lon - r.lon) < 0.0026);
      if (!dup) kept.push(r);
      if (kept.length === limit) break;
    }
    return kept;
  }
}
