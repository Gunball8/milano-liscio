/**
 * Tag classification shared by the build scripts (Node) and the routing worker.
 * Pure TypeScript, no DOM, no Node APIs. Rules: SPEC §6.1 (bike access) and §6.2 (surface classes),
 * plus the phase 0 decisions recorded in docs/audit-notes.md (surface_bike precedence, extra values).
 */

export type Tags = Record<string, string>;

export const SURFACE_CLASSES = ['SMOOTH', 'SLABS', 'PAVE', 'LOOSE', 'UNKNOWN'] as const;
export type SurfaceClass = (typeof SURFACE_CLASSES)[number];
export const SURFACE_CODE: Record<SurfaceClass, number> = { SMOOTH: 0, SLABS: 1, PAVE: 2, LOOSE: 3, UNKNOWN: 4 };

const SMOOTH_VALUES = new Set([
  'asphalt', 'concrete', 'concrete:plates', 'concrete:lanes', 'paved', 'chipseal', 'metal', 'rubber',
  // phase 0 decision 5
  'wood', 'metal_grid', 'tiles', 'tartan', 'linoleum',
]);
const PAVE_VALUES = new Set([
  'sett', 'cobblestone', 'cobblestone:flattened', 'unhewn_cobblestone',
  // phase 0 decision 5
  'cobblestone:rounded', 'stone',
]);
const LOOSE_VALUES = new Set([
  'unpaved', 'compacted', 'fine_gravel', 'gravel', 'pebblestone', 'ground', 'dirt', 'earth', 'grass', 'sand', 'mud',
  // phase 0 decision 5
  'grass_paver', 'woodchips',
]);

/** Severity used to merge multi-valued tags ("a;b"): the worst recognized class wins. */
const SEVERITY: Record<SurfaceClass, number> = { SMOOTH: 0, UNKNOWN: 1, LOOSE: 2, SLABS: 3, PAVE: 4 };

export interface SurfaceResult {
  cls: SurfaceClass;
  /** false when a value exists but is not in the table (classified UNKNOWN, must be logged). */
  recognized: boolean;
}

function classifySingle(value: string): SurfaceResult {
  if (SMOOTH_VALUES.has(value)) return { cls: 'SMOOTH', recognized: true };
  if (value === 'bricks' || value === 'paving_stones' || value.startsWith('paving_stones:')) return { cls: 'SLABS', recognized: true };
  if (PAVE_VALUES.has(value)) return { cls: 'PAVE', recognized: true };
  // Milanese local scheme: milanese_paving, milanese_paving:rails, milanese_paving:lanes
  if (value === 'milanese_paving' || value.startsWith('milanese_paving:')) return { cls: 'PAVE', recognized: true };
  if (LOOSE_VALUES.has(value)) return { cls: 'LOOSE', recognized: true };
  return { cls: 'UNKNOWN', recognized: false };
}

export function classifySurfaceValue(value: string | undefined): SurfaceResult {
  if (value === undefined || value === '') return { cls: 'UNKNOWN', recognized: true };
  if (!value.includes(';')) return classifySingle(value);
  const parts = value.split(';').map((p) => classifySingle(p.trim()));
  if (parts.some((p) => !p.recognized)) return { cls: 'UNKNOWN', recognized: false };
  return parts.reduce((a, b) => (SEVERITY[b.cls] > SEVERITY[a.cls] ? b : a));
}

/**
 * Surface class of the strip a cyclist rides on, ignoring direction-specific cycle lanes.
 * `surface_bike` (Milanese local scheme) takes precedence over `surface` when recognized (decision 4).
 * `smoothness=excellent/good` downgrades PAVE to SLABS.
 */
export function classifyWaySurface(tags: Tags): SurfaceResult {
  let base = classifySurfaceValue(tags['surface']);
  const bike = tags['surface_bike'];
  if (bike) {
    const b = classifySurfaceValue(bike);
    if (b.recognized) base = b;
    else base = { cls: base.cls, recognized: false };
  }
  if (base.cls === 'PAVE' && (tags['smoothness'] === 'excellent' || tags['smoothness'] === 'good')) {
    return { cls: 'SLABS', recognized: base.recognized };
  }
  return base;
}

export type Direction = 'forward' | 'backward';

/**
 * Effective surface for one travel direction (§6.2): with right-hand traffic, a cycle lane on the
 * `right` serves the way's direction and one on the `left` the reverse; its own surface tag wins.
 */
export function effectiveSurface(tags: Tags, dir: Direction): SurfaceResult {
  const side = dir === 'forward' ? 'right' : 'left';
  const lane = tags[`cycleway:${side}:surface`] ?? tags['cycleway:both:surface'] ?? tags['cycleway:surface'];
  if (lane) {
    const r = classifySurfaceValue(lane);
    if (r.recognized && r.cls !== 'UNKNOWN') return r;
  }
  return classifyWaySurface(tags);
}

/** Rails known from the street's own tags (§6.3 rule 1, plus `surface_bike=milanese_paving:rails`, decision 4). */
export function hasTaggedRails(tags: Tags): boolean {
  const e = tags['embedded_rails'];
  if (e === 'tram' || e === 'yes') return true;
  return (tags['surface_bike'] ?? '').endsWith(':rails');
}

/**
 * Access model (owner's choice, 2026-11-25, replaces SPEC §6.1): pedestrian rules, bike physics.
 * A way is usable when a pedestrian or a cyclist may use it, in both directions and always ridden:
 * no oneways, sidewalks and pedestrian areas included, never "walk the bike". Still out: motor roads,
 * private or closed ways, stairs without a ramp, and what is not a way (platforms, corridors, works).
 * 'push' stays in the type for the graph format (FLAG_PUSH) but is no longer produced.
 */
export type BikeMode = 'ride' | 'push' | 'excluded';

const MOTOR_ONLY = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);
const USABLE = new Set([
  'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
  'unclassified', 'residential', 'living_street', 'service', 'road',
  'cycleway', 'track', 'path', 'pedestrian', 'footway', 'bridleway',
]);
/** Explicit permission. */
const ALLOWED = new Set(['yes', 'designated', 'permissive']);
const FORBIDDEN = new Set(['no', 'private']);

/** Access of a way, the same in both directions. */
export function wayAccess(tags: Tags): BikeMode {
  const hw = tags['highway'];
  if (!hw) return 'excluded';
  const foot = tags['foot'] ?? '';
  const bike = tags['bicycle'] ?? '';
  const explicit = ALLOWED.has(foot) || ALLOWED.has(bike);
  // stairs: only with a ramp to roll the bike on
  if (hw === 'steps') return tags['ramp:bicycle'] === 'yes' || tags['ramp:stroller'] === 'yes' || ALLOWED.has(bike) ? 'ride' : 'excluded';
  if (MOTOR_ONLY.has(hw)) return explicit ? 'ride' : 'excluded';
  if (!USABLE.has(hw)) return 'excluded';
  if (FORBIDDEN.has(tags['access'] ?? '') && !explicit) return 'excluded';
  // closed to pedestrians and to bikes (road tunnels, expressway ramps); a footway closed to pedestrians
  if (FORBIDDEN.has(foot) && (FORBIDDEN.has(bike) || (hw === 'footway' && !ALLOWED.has(bike)))) return 'excluded';
  return 'ride';
}

export interface DirectionalAccess {
  forward: BikeMode;
  backward: BikeMode;
}

/** Access per direction: oneways do not apply (pedestrian rules), so both directions match. */
export function directionalAccess(tags: Tags): DirectionalAccess {
  const m = wayAccess(tags);
  return { forward: m, backward: m };
}

/** Barriers a bike cannot get through, whatever the access tags. */
const ALWAYS_BLOCKING = new Set(['turnstile', 'full-height_turnstile', 'stile', 'kissing_gate', 'fence', 'wall', 'wire_fence', 'retaining_wall', 'hedge']);
/** Barriers that close a passage when access is restricted (gates and similar). */
const GATES = new Set(['gate', 'lift_gate', 'swing_gate', 'sliding_gate', 'chain', 'hampshire_gate', 'wicket_gate', 'bump_gate', 'spikes']);

/**
 * True when a barrier node closes the way (audit 2026-11-25: ~620 private gates and ~140 locked ones
 * sat on the network). Pedestrian rules: a gate is closed when locked, private or forbidden to all,
 * unless pedestrians or bikes are explicitly allowed; bicycle=no alone no longer closes it. Turnstiles
 * and stiles stop a bike. Bollards, kerbs, blocks and cycle barriers stay passable.
 */
export function barrierBlocksBikes(tags: Tags): boolean {
  const b = tags['barrier'];
  if (!b) return false;
  const foot = tags['foot'] ?? '';
  const bike = tags['bicycle'] ?? '';
  if (ALLOWED.has(bike)) return false;
  if (ALWAYS_BLOCKING.has(b)) return true;
  if (!GATES.has(b)) return false;
  if (tags['locked'] === 'yes') return true;
  if (ALLOWED.has(foot)) return false;
  return FORBIDDEN.has(tags['access'] ?? '') || (FORBIDDEN.has(foot) && FORBIDDEN.has(bike));
}

/** Audit grouping of highway values. */
export type RoadGroup = 'main' | 'service' | 'soft';

const MAIN_ROADS = new Set([
  'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
  'unclassified', 'residential', 'living_street', 'road', 'motorway', 'motorway_link', 'trunk', 'trunk_link',
]);
const SOFT_WAYS = new Set(['cycleway', 'path', 'track', 'pedestrian', 'footway']);

export function roadGroup(tags: Tags): RoadGroup | null {
  const hw = tags['highway'] ?? '';
  if (MAIN_ROADS.has(hw)) return 'main';
  if (hw === 'service') return 'service';
  if (SOFT_WAYS.has(hw)) return 'soft';
  return null;
}

/**
 * Carriageway in the sense of §6.3: ways on which embedded tram rails are searched spatially.
 * Excludes cycleway, footway, path, track. Pedestrian streets are kept because trams cross some of them.
 */
export function isCarriageway(tags: Tags): boolean {
  const g = roadGroup(tags);
  return g === 'main' || g === 'service' || tags['highway'] === 'pedestrian';
}

/** Polygonal ways (pedestrian squares): routed on their outline, kept out of length statistics. */
export function isArea(tags: Tags): boolean {
  return tags['area'] === 'yes';
}

/** Physically present tram rails (§6.3). `abandoned` is ignored. */
export function isPresentRail(tags: Tags): boolean {
  return tags['railway'] === 'tram' || tags['railway'] === 'disused' || tags['disused:railway'] === 'tram';
}
