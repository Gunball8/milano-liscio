/**
 * Tag classification shared by the build scripts (Node) and the routing worker.
 * Pure TypeScript, no DOM, no Node APIs. Rules: SPEC §6.1 (bike access) and §6.2 (surface classes).
 */

export type Tags = Record<string, string>;

export const SURFACE_CLASSES = ['SMOOTH', 'SLABS', 'PAVE', 'LOOSE', 'UNKNOWN'] as const;
export type SurfaceClass = (typeof SURFACE_CLASSES)[number];

const SMOOTH_VALUES = new Set(['asphalt', 'concrete', 'concrete:plates', 'concrete:lanes', 'paved', 'chipseal', 'metal', 'rubber']);
const PAVE_VALUES = new Set(['sett', 'cobblestone', 'cobblestone:flattened', 'unhewn_cobblestone']);
const LOOSE_VALUES = new Set([
  'unpaved', 'compacted', 'fine_gravel', 'gravel', 'pebblestone', 'ground', 'dirt', 'earth', 'grass', 'sand', 'mud',
]);

export interface SurfaceResult {
  cls: SurfaceClass;
  /** false when a `surface` value exists but is not in the §6.2 table (classified UNKNOWN, must be logged). */
  recognized: boolean;
}

export function classifySurfaceValue(value: string | undefined): SurfaceResult {
  if (value === undefined || value === '') return { cls: 'UNKNOWN', recognized: true };
  if (SMOOTH_VALUES.has(value)) return { cls: 'SMOOTH', recognized: true };
  if (value === 'bricks' || value === 'paving_stones' || value.startsWith('paving_stones:')) return { cls: 'SLABS', recognized: true };
  if (PAVE_VALUES.has(value)) return { cls: 'PAVE', recognized: true };
  if (LOOSE_VALUES.has(value)) return { cls: 'LOOSE', recognized: true };
  return { cls: 'UNKNOWN', recognized: false };
}

/**
 * Surface class of the way itself (road surface), before any per-direction cycleway override.
 * `surface_bike=milanese_paving` forces PAVE; `smoothness=excellent/good` downgrades PAVE to SLABS.
 */
export function classifyWaySurface(tags: Tags): SurfaceResult {
  const base: SurfaceResult =
    tags['surface_bike'] === 'milanese_paving' ? { cls: 'PAVE', recognized: true } : classifySurfaceValue(tags['surface']);
  if (base.cls === 'PAVE' && (tags['smoothness'] === 'excellent' || tags['smoothness'] === 'good')) {
    return { cls: 'SLABS', recognized: base.recognized };
  }
  return base;
}

export type BikeMode = 'ride' | 'push' | 'excluded';

const MOTOR_ONLY = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);
const RIDEABLE = new Set([
  'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
  'unclassified', 'residential', 'living_street', 'service', 'road',
  'cycleway', 'track', 'path', 'pedestrian',
]);
const BIKE_ALLOWED = new Set(['yes', 'designated', 'permissive']);

/** Direction-independent bike access (§6.1). Oneway and contraflow handling belongs to the graph builder. */
export function bikeAccess(tags: Tags): BikeMode {
  const hw = tags['highway'];
  if (!hw || hw === 'steps' || hw === 'construction' || hw === 'proposed') return 'excluded';
  if (tags['bicycle'] === 'no') return 'excluded';
  const bikeAllowed = BIKE_ALLOWED.has(tags['bicycle'] ?? '');
  if (MOTOR_ONLY.has(hw)) return bikeAllowed ? 'ride' : 'excluded';
  if ((tags['access'] === 'no' || tags['access'] === 'private') && !bikeAllowed) return 'excluded';
  if (hw === 'footway') {
    if (bikeAllowed) return 'ride';
    if (tags['footway'] === 'sidewalk') return 'excluded';
    return 'push';
  }
  if (RIDEABLE.has(hw)) return tags['bicycle'] === 'dismount' ? 'push' : 'ride';
  return 'excluded';
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
