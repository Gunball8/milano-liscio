/**
 * Live guidance logic (SPEC §9.2), free of browser APIs so it can be unit tested:
 * progress along the route, remaining distance and time, next degraded stretch, off-route and arrival.
 */
import { MILAN_PROJECTION as P, haversine } from './geo.ts';

export interface TrackSegment {
  coords: [number, number][];
  cls: number;
  push: boolean;
  rail: boolean;
}

export type StretchKind = 'pave' | 'rails' | 'slabs' | 'push';

export interface NextStretch {
  kinds: StretchKind[];
  /** Meters until the stretch starts (0 when already on it). */
  inM: number;
  /** Length still ahead on that stretch. */
  lengthM: number;
}

export interface Located {
  /** Meters from the start of the route to the projected point. */
  along: number;
  /** Distance from the fix to the route. */
  offset: number;
  /** Direction of the route at that point, degrees clockwise from north. */
  bearing: number;
}

export const OFF_ROUTE_M = 35;
export const GOOD_ACCURACY_M = 30;
export const OFF_ROUTE_FIXES = 3;
export const ARRIVAL_M = 25;
const WINDOW_BACK_M = 40;
const WINDOW_AHEAD_M = 400;

const kindsOf = (s: { cls: number; push: boolean; rail: boolean }): StretchKind[] => {
  const k: StretchKind[] = [];
  if (s.cls === 2) k.push('pave');
  if (s.rail) k.push('rails');
  if (s.cls === 1) k.push('slabs');
  if (s.push) k.push('push');
  return k;
};

const sameKinds = (a: StretchKind[], b: StretchKind[]) => a.length === b.length && a.every((k, i) => k === b[i]);

export class RouteTracker {
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  /** Cumulative distance at each vertex. */
  private readonly cum: number[] = [];
  /** Cumulative travel time (s) at each vertex. */
  private readonly cumTime: number[] = [];
  /** Homogeneous stretches with their [from, to] along-route interval. */
  readonly stretches: { from: number; to: number; kinds: StretchKind[] }[] = [];
  readonly length: number;
  readonly end: [number, number];
  private progress = 0;

  constructor(segments: TrackSegment[], speeds = { ride: 15, push: 4.5 }) {
    let along = 0;
    let time = 0;
    for (const seg of segments) {
      const from = along;
      const mps = ((seg.push ? speeds.push : speeds.ride) * 1000) / 3600;
      seg.coords.forEach(([lon, lat], i) => {
        const x = P.x(lon);
        const y = P.y(lat);
        if (this.xs.length > 0) {
          const d = Math.hypot(x - this.xs[this.xs.length - 1]!, y - this.ys[this.ys.length - 1]!);
          if (i === 0 && d < 0.01) return; // shared vertex between segments
          along += d;
          time += d / mps;
        }
        this.xs.push(x);
        this.ys.push(y);
        this.cum.push(along);
        this.cumTime.push(time);
      });
      const kinds = kindsOf(seg);
      const last = this.stretches[this.stretches.length - 1];
      if (last && sameKinds(last.kinds, kinds) && Math.abs(last.to - from) < 0.01) last.to = along;
      else this.stretches.push({ from, to: along, kinds });
    }
    this.length = along;
    const lastSeg = segments[segments.length - 1]!;
    this.end = lastSeg.coords[lastSeg.coords.length - 1]!;
  }

  /** Nearest point between two along-route bounds. */
  private nearest(px: number, py: number, minAlong: number, maxAlong: number): Located & { found: boolean } {
    let best = { along: 0, offset: Infinity, bearing: 0, found: false };
    for (let i = 1; i < this.xs.length; i++) {
      if (this.cum[i]! < minAlong || this.cum[i - 1]! > maxAlong) continue;
      const ax = this.xs[i - 1]!;
      const ay = this.ys[i - 1]!;
      const dx = this.xs[i]! - ax;
      const dy = this.ys[i]! - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
      if (d < best.offset) {
        best = {
          along: this.cum[i - 1]! + t * (this.cum[i]! - this.cum[i - 1]!),
          offset: d,
          bearing: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360,
          found: true,
        };
      }
    }
    return best;
  }

  /**
   * Projects a fix on the route. Searches near the current progress first so the position does not
   * jump to another part of the route that passes close by (loops, back-and-forth streets).
   */
  locate(lon: number, lat: number): Located {
    const px = P.x(lon);
    const py = P.y(lat);
    let r = this.nearest(px, py, this.progress - WINDOW_BACK_M, this.progress + WINDOW_AHEAD_M);
    if (!r.found || r.offset > OFF_ROUTE_M) {
      const all = this.nearest(px, py, -Infinity, Infinity);
      if (all.offset < r.offset) r = all;
    }
    if (r.offset <= OFF_ROUTE_M) this.progress = Math.max(this.progress, r.along);
    return { along: r.along, offset: r.offset, bearing: r.bearing };
  }

  get progressM(): number {
    return this.progress;
  }

  remainingM(along = this.progress): number {
    return Math.max(0, this.length - along);
  }

  /** Remaining travel time in seconds, using the speed of each stretch. */
  remainingS(along = this.progress): number {
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i]! < along) i++;
    const f = this.cum[i]! === this.cum[i - 1]! ? 0 : (along - this.cum[i - 1]!) / (this.cum[i]! - this.cum[i - 1]!);
    const tAt = this.cumTime[i - 1]! + Math.max(0, Math.min(1, f)) * (this.cumTime[i]! - this.cumTime[i - 1]!);
    return Math.max(0, this.cumTime[this.cumTime.length - 1]! - tAt);
  }

  /** Next stretch that is not plain smooth riding (pavé, rails, slabs or pushing). */
  nextDegraded(along = this.progress): NextStretch | null {
    for (const s of this.stretches) {
      if (s.kinds.length === 0 || s.to <= along + 1) continue;
      return { kinds: s.kinds, inM: Math.max(0, s.from - along), lengthM: s.to - Math.max(s.from, along) };
    }
    return null;
  }

  distanceToEnd(lon: number, lat: number): number {
    return haversine(lon, lat, this.end[0], this.end[1]);
  }
}

/**
 * Off-route rule (SPEC §9.2): more than 35 m from the route on 3 consecutive fixes whose accuracy is
 * better than 30 m. Any other fix (on route, or too imprecise to judge) breaks the sequence.
 */
export class OffRouteDetector {
  private count = 0;

  /** Returns true when a recalculation should start. */
  push(offset: number, accuracy: number): boolean {
    if (accuracy < GOOD_ACCURACY_M && offset > OFF_ROUTE_M) this.count++;
    else this.count = 0;
    if (this.count >= OFF_ROUTE_FIXES) {
      this.count = 0;
      return true;
    }
    return false;
  }

  reset() {
    this.count = 0;
  }
}

/** Course over ground: GPS heading when moving fast enough, else from two successive fixes. */
export function courseFrom(prev: { lon: number; lat: number; t: number } | null, cur: { lon: number; lat: number; t: number }, raw: { heading: number | null; speed: number | null }) {
  // null, NaN or negative values mean "not provided"
  const valid = (v: number | null) => (v !== null && Number.isFinite(v) && v >= 0 ? v : null);
  const gps = { heading: valid(raw.heading), speed: valid(raw.speed) };
  if (gps.heading !== null && gps.speed !== null) return { heading: gps.heading, speed: gps.speed };
  if (!prev || cur.t <= prev.t) return { heading: null, speed: gps.speed };
  const d = haversine(prev.lon, prev.lat, cur.lon, cur.lat);
  const speed = gps.speed ?? d / ((cur.t - prev.t) / 1000);
  if (d < 3) return { heading: null, speed };
  const dx = P.x(cur.lon) - P.x(prev.lon);
  const dy = P.y(cur.lat) - P.y(prev.lat);
  return { heading: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360, speed };
}

/** Speed above which the map follows the course (SPEC §9.2). */
export const ROTATE_ABOVE_MPS = 2;
