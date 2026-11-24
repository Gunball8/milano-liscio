/**
 * OSM tags of the graph's ways, shown in the segment sheet of the Corrections screen (SPEC §9.3).
 * Tag sets are deduplicated: many ways share the same tags apart from their name.
 * Aligned with the graph's way index (built by the same script).
 */
export const WAYTAGS_MAGIC = 0x4d4c5754; // "MLWT"
export const WAYTAGS_VERSION = 1;

/** Keys left out: translations, external references and bookkeeping that say nothing about the street surface. */
export function keepTag(key: string): boolean {
  return !/^(name:|alt_name|old_name|official_name|wikidata|wikipedia|source|note|fixme|FIXME|check_date|loc_ref|postal_code|ref:|mapillary|survey|created_by|tiger:|is_in)/.test(key);
}

export function serializeWayTags(sets: string[], wayToSet: Uint32Array): Uint8Array {
  const enc = new TextEncoder();
  const blobs = sets.map((s) => enc.encode(s));
  const offsets = new Uint32Array(sets.length + 1);
  let total = 0;
  blobs.forEach((b, i) => {
    offsets[i] = total;
    total += b.length;
  });
  offsets[sets.length] = total;
  const head = 16;
  const offBytes = offsets.byteLength;
  const mapStart = head + offBytes;
  const strStart = mapStart + wayToSet.byteLength;
  const out = new Uint8Array(strStart + total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, WAYTAGS_MAGIC, true);
  dv.setUint32(4, WAYTAGS_VERSION, true);
  dv.setUint32(8, sets.length, true);
  dv.setUint32(12, wayToSet.length, true);
  out.set(new Uint8Array(offsets.buffer), head);
  out.set(new Uint8Array(wayToSet.buffer, wayToSet.byteOffset, wayToSet.byteLength), mapStart);
  blobs.forEach((b, i) => out.set(b, strStart + offsets[i]!));
  return out;
}

export class WayTags {
  private readonly offsets: Uint32Array;
  private readonly wayToSet: Uint32Array;
  private readonly strings: Uint8Array;
  private readonly decoder = new TextDecoder();

  constructor(buffer: ArrayBuffer) {
    const dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== WAYTAGS_MAGIC) throw new Error('not a Milano Liscio way-tags file');
    if (dv.getUint32(4, true) !== WAYTAGS_VERSION) throw new Error('unsupported way-tags version');
    const sets = dv.getUint32(8, true);
    const ways = dv.getUint32(12, true);
    this.offsets = new Uint32Array(buffer, 16, sets + 1);
    const mapStart = 16 + this.offsets.byteLength;
    this.wayToSet = new Uint32Array(buffer, mapStart, ways);
    this.strings = new Uint8Array(buffer, mapStart + this.wayToSet.byteLength);
  }

  /** Tags of a graph way, as [key, value] pairs sorted by key. */
  tags(way: number): [string, string][] {
    const set = this.wayToSet[way];
    if (set === undefined) return [];
    const s = this.decoder.decode(this.strings.subarray(this.offsets[set]!, this.offsets[set + 1]!));
    return s
      ? s.split('\n').map((line) => {
          const i = line.indexOf('=');
          return [line.slice(0, i), line.slice(i + 1)] as [string, string];
        })
      : [];
  }
}
