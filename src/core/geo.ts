/** Geometry helpers shared by build scripts and the app. Pure TypeScript. */

export const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

/** Great-circle distance in meters. */
export function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Equirectangular projection around a reference point, in meters.
 * Over Milan (about 20 km across) the scale error stays below 0.1 %.
 */
export class LocalProjection {
  readonly kx: number;
  readonly ky: number;
  constructor(
    readonly lon0: number,
    readonly lat0: number,
  ) {
    this.ky = EARTH_RADIUS_M * DEG;
    this.kx = this.ky * Math.cos(lat0 * DEG);
  }
  x(lon: number): number {
    return (lon - this.lon0) * this.kx;
  }
  y(lat: number): number {
    return (lat - this.lat0) * this.ky;
  }
  lon(x: number): number {
    return this.lon0 + x / this.kx;
  }
  lat(y: number): number {
    return this.lat0 + y / this.ky;
  }
}

/** Reference projection for the Milan dataset (Piazza del Duomo). */
export const MILAN_PROJECTION = new LocalProjection(9.1919, 45.4641);

/** Distance from point P to segment AB, all in projected meters. */
export function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

/** Angle between two undirected lines, in degrees, within [0, 90]. */
export function lineAngleDiff(dx1: number, dy1: number, dx2: number, dy2: number): number {
  let d = Math.abs(Math.atan2(dy1, dx1) - Math.atan2(dy2, dx2)) / DEG;
  d %= 180;
  return d > 90 ? 180 - d : d;
}
