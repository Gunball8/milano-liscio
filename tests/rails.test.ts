import { describe, expect, it } from 'vitest';
import { MILAN_PROJECTION as P } from '../src/core/geo.ts';
import { RailIndex, countShallowCrossings, isRailMarked, railLength, sampleEdgeRails } from '../scripts/lib/rails.ts';

/** A straight east-west line at a given northward offset (m) from the Duomo, `length` meters long. */
const line = (offsetY: number, length: number, angleDeg = 0): [number, number][] => {
  const a = (angleDeg * Math.PI) / 180;
  return [
    [P.lon(0), P.lat(offsetY)],
    [P.lon(length * Math.cos(a)), P.lat(offsetY + length * Math.sin(a))],
  ];
};
const xyOf = (coords: [number, number][]) => Float64Array.from(coords.flatMap(([lon, lat]) => [P.x(lon), P.y(lat)]));

describe('spatial rail detection (SPEC §6.3)', () => {
  const road = line(0, 100);
  const roadXY = xyOf(road);

  it('measures the offset of a parallel rail and thresholds by D', () => {
    const index = new RailIndex([{ coords: line(4.5, 200), layer: 0 }], 10);
    const s = sampleEdgeRails(roadXY, 100, index, 0);
    expect(s.dist.length).toBe(10);
    for (const d of s.dist) expect(d).toBeCloseTo(4.5, 1);
    expect(railLength(s, 4)).toBe(0);
    expect(railLength(s, 5)).toBeCloseTo(100, 6);
  });

  it('ignores rails crossing at a steep angle', () => {
    const index = new RailIndex([{ coords: line(0, 50, 45), layer: 0 }], 10);
    const s = sampleEdgeRails(roadXY, 100, index, 0);
    expect(railLength(s, 6)).toBe(0);
  });

  it('accepts rails within 20° and rejects beyond', () => {
    const near = new RailIndex([{ coords: line(1, 100, 3), layer: 0 }], 10);
    expect(railLength(sampleEdgeRails(roadXY, 100, near, 0), 6)).toBeGreaterThan(0);
    const steep = new RailIndex([{ coords: line(1, 100, 25), layer: 0 }], 10);
    expect(railLength(sampleEdgeRails(roadXY, 100, steep, 0), 6)).toBeLessThanOrEqual(10);
  });

  it('ignores rails on another layer', () => {
    const index = new RailIndex([{ coords: line(0, 100), layer: 1 }], 10);
    expect(railLength(sampleEdgeRails(roadXY, 100, index, 0), 6)).toBe(0);
  });

  it('marks an edge at 30 m or 30 % of its length', () => {
    expect(isRailMarked(30, 500)).toBe(true);
    expect(isRailMarked(20, 60)).toBe(true);
    expect(isRailMarked(20, 100)).toBe(false);
    expect(isRailMarked(0, 5)).toBe(false);
  });
});

describe('shallow crossings (SPEC §6.3.4)', () => {
  const road = xyOf(line(0, 100));
  const crossing = (angle: number) => {
    // rail through the road midpoint (50, 0) at the given angle
    const a = (angle * Math.PI) / 180;
    const c: [number, number][] = [
      [P.lon(50 - 30 * Math.cos(a)), P.lat(-30 * Math.sin(a))],
      [P.lon(50 + 30 * Math.cos(a)), P.lat(30 * Math.sin(a))],
    ];
    return new RailIndex([{ coords: c, layer: 0 }], 0);
  };
  it('counts crossings between 10° and 45°, not steep or near-parallel ones', () => {
    expect(countShallowCrossings(road, crossing(30), 0)).toBe(1);
    expect(countShallowCrossings(road, crossing(60), 0)).toBe(0);
    expect(countShallowCrossings(road, crossing(90), 0)).toBe(0);
    expect(countShallowCrossings(road, crossing(5), 0)).toBe(0);
  });
  it('ignores rails on another layer', () => {
    const idx = new RailIndex([{ coords: [[P.lon(40), P.lat(-10)], [P.lon(60), P.lat(10)]], layer: 1 }], 0);
    expect(countShallowCrossings(road, idx, 0)).toBe(0);
  });
});
