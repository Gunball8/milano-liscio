import { describe, expect, it } from 'vitest';
import { MILAN_PROJECTION as P } from '../src/core/geo.ts';
import { type LockSentinelLike, ScreenLock } from '../src/core/screenLock.ts';
import { OffRouteDetector, RouteTracker, type TrackSegment, courseFrom } from '../src/core/tracking.ts';

/** Point x meters east and y meters north of the Duomo. */
const pt = (x: number, y = 0): [number, number] => [P.lon(x), P.lat(y)];
const seg = (x0: number, x1: number, o: Partial<TrackSegment> = {}): TrackSegment => ({ coords: [pt(x0), pt(x1)], cls: 0, push: false, rail: false, ...o });

// 1 km eastward: smooth, pavé with rails, smooth, pushing, smooth.
const straight = [seg(0, 300), seg(300, 450, { cls: 2, rail: true }), seg(450, 600), seg(600, 700, { push: true }), seg(700, 1000)];

describe('RouteTracker (SPEC §9.2)', () => {
  it('projects fixes and measures what is left', () => {
    const t = new RouteTracker(straight);
    expect(t.length).toBeCloseTo(1000, 0);
    const l = t.locate(...pt(100, 10));
    expect(l.along).toBeCloseTo(100, 0);
    expect(l.offset).toBeCloseTo(10, 0);
    expect(l.bearing).toBeCloseTo(90, 0);
    expect(t.remainingM()).toBeCloseTo(900, 0);
    // 800 m riding at 15 km/h + 100 m pushing at 4.5 km/h
    expect(t.remainingS()).toBeCloseTo(800 / (15 / 3.6) + 100 / (4.5 / 3.6), -1);
  });

  it('announces the next degraded stretch, then how much of it is left', () => {
    const t = new RouteTracker(straight);
    expect(t.nextDegraded(100)).toEqual({ kinds: ['pave', 'rails'], inM: expect.closeTo(200, 0), lengthM: expect.closeTo(150, 0) });
    expect(t.nextDegraded(350)).toEqual({ kinds: ['pave', 'rails'], inM: 0, lengthM: expect.closeTo(100, 0) });
    expect(t.nextDegraded(460)).toEqual({ kinds: ['push'], inM: expect.closeTo(140, 0), lengthM: expect.closeTo(100, 0) });
    expect(t.nextDegraded(750)).toBeNull();
  });

  it('does not jump to the return leg of a U-turn passing 20 m away', () => {
    const uturn: TrackSegment[] = [
      { coords: [pt(0), pt(500)], cls: 0, push: false, rail: false },
      { coords: [pt(500), pt(500, 20), pt(0, 20)], cls: 0, push: false, rail: false },
    ];
    const t = new RouteTracker(uturn);
    t.locate(...pt(80, 0));
    const l = t.locate(...pt(100, 12)); // closer to the return leg (8 m) than to the outward leg (12 m)
    expect(l.along).toBeCloseTo(100, 0);
  });

  it('progress never goes backwards on the route', () => {
    const t = new RouteTracker(straight);
    t.locate(...pt(400));
    t.locate(...pt(380));
    expect(t.progressM).toBeCloseTo(400, 0);
  });

  it('measures the distance to the destination for the 25 m arrival rule', () => {
    const t = new RouteTracker(straight);
    expect(t.distanceToEnd(...pt(990))).toBeCloseTo(10, 0);
  });
});

describe('OffRouteDetector (SPEC §9.2)', () => {
  it('triggers on the third consecutive precise fix beyond 35 m', () => {
    const d = new OffRouteDetector();
    expect(d.push(50, 10)).toBe(false);
    expect(d.push(50, 10)).toBe(false);
    expect(d.push(50, 10)).toBe(true);
  });
  it('an imprecise fix or a fix back on the route breaks the sequence', () => {
    const d = new OffRouteDetector();
    d.push(50, 10);
    d.push(50, 10);
    expect(d.push(50, 45)).toBe(false); // accuracy 45 m: not judged
    expect(d.push(50, 10)).toBe(false);
    d.push(50, 10);
    expect(d.push(10, 10)).toBe(false); // back on route
    expect(d.push(50, 10)).toBe(false);
  });
});

describe('courseFrom', () => {
  it('uses the GPS course when given, else the bearing between fixes', () => {
    expect(courseFrom(null, { lon: 9, lat: 45, t: 0 }, { heading: 120, speed: 5 })).toEqual({ heading: 120, speed: 5 });
    const a = { lon: pt(0)[0], lat: pt(0)[1], t: 0 };
    const b = { lon: pt(0, 50)[0], lat: pt(0, 50)[1], t: 10_000 }; // 50 m north in 10 s
    const c = courseFrom(a, b, { heading: null, speed: null });
    expect(c.heading).toBeCloseTo(0, 0);
    expect(c.speed).toBeCloseTo(5, 1);
  });
});

describe('ScreenLock (SPEC §4.4)', () => {
  function fakeApi(fail?: string) {
    const listeners: (() => void)[] = [];
    let requests = 0;
    const api = {
      async request(): Promise<LockSentinelLike> {
        requests++;
        if (fail) throw Object.assign(new Error(fail), { name: fail });
        return { release: async () => listeners.forEach((l) => l()), addEventListener: (_t: 'release', l: () => void) => listeners.push(l) };
      },
    };
    return { api, listeners, requests: () => requests };
  }

  it('acquires, is re-acquired when the page comes back, and releases on disable', async () => {
    const f = fakeApi();
    const lock = new ScreenLock(f.api);
    expect(await lock.enable()).toBe('on');
    f.listeners.forEach((l) => l()); // the system dropped the lock (app in background)
    expect(lock.state).toBe('off');
    await lock.onVisible();
    expect(lock.state).toBe('on');
    expect(f.requests()).toBe(2);
    await lock.disable();
    await lock.onVisible();
    expect(f.requests()).toBe(2);
  });

  it('reports a missing API and a refusal', async () => {
    expect(await new ScreenLock(undefined).enable()).toBe('unsupported');
    expect(await new ScreenLock(fakeApi('NotAllowedError').api).enable()).toBe('denied');
  });
});

describe('courseFrom with missing or invalid GPS values', () => {
  it('ignores NaN and negative speed or heading', () => {
    const a = { lon: pt(0)[0], lat: pt(0)[1], t: 0 };
    const b = { lon: pt(50)[0], lat: pt(50)[1], t: 5_000 }; // 50 m east in 5 s
    const c = courseFrom(a, b, { heading: Number.NaN, speed: -1 });
    expect(c.heading).toBeCloseTo(90, 0);
    expect(c.speed).toBeCloseTo(10, 1);
  });
});
