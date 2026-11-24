import { describe, expect, it } from 'vitest';
import { bikeAccess, classifySurfaceValue, classifyWaySurface, isCarriageway, isPresentRail } from '../src/core/classify.ts';

describe('classifySurfaceValue (SPEC §6.2)', () => {
  it.each([
    ['asphalt', 'SMOOTH'],
    ['concrete:plates', 'SMOOTH'],
    ['paving_stones', 'SLABS'],
    ['paving_stones:30', 'SLABS'],
    ['bricks', 'SLABS'],
    ['sett', 'PAVE'],
    ['cobblestone', 'PAVE'],
    ['cobblestone:flattened', 'PAVE'],
    ['unhewn_cobblestone', 'PAVE'],
    ['fine_gravel', 'LOOSE'],
    ['ground', 'LOOSE'],
  ] as const)('%s -> %s', (value, cls) => {
    expect(classifySurfaceValue(value)).toEqual({ cls, recognized: true });
  });

  it('missing surface is UNKNOWN and recognized', () => {
    expect(classifySurfaceValue(undefined)).toEqual({ cls: 'UNKNOWN', recognized: true });
  });

  it('unlisted value is UNKNOWN and flagged for logging', () => {
    expect(classifySurfaceValue('granite')).toEqual({ cls: 'UNKNOWN', recognized: false });
    expect(classifySurfaceValue('sett;asphalt')).toEqual({ cls: 'UNKNOWN', recognized: false });
  });
});

describe('classifyWaySurface', () => {
  it('surface_bike=milanese_paving forces PAVE', () => {
    expect(classifyWaySurface({ surface: 'asphalt', surface_bike: 'milanese_paving' }).cls).toBe('PAVE');
  });
  it('smoothness good/excellent downgrades PAVE to SLABS', () => {
    expect(classifyWaySurface({ surface: 'sett', smoothness: 'good' }).cls).toBe('SLABS');
    expect(classifyWaySurface({ surface: 'sett', smoothness: 'excellent' }).cls).toBe('SLABS');
    expect(classifyWaySurface({ surface: 'sett', smoothness: 'intermediate' }).cls).toBe('PAVE');
  });
  it('smoothness has no other effect', () => {
    expect(classifyWaySurface({ surface: 'paving_stones', smoothness: 'bad' }).cls).toBe('SLABS');
  });
});

describe('bikeAccess (SPEC §6.1)', () => {
  it.each([
    [{ highway: 'motorway' }, 'excluded'],
    [{ highway: 'trunk', bicycle: 'yes' }, 'ride'],
    [{ highway: 'residential', bicycle: 'no' }, 'excluded'],
    [{ highway: 'service', access: 'private' }, 'excluded'],
    [{ highway: 'service', access: 'private', bicycle: 'yes' }, 'ride'],
    [{ highway: 'steps' }, 'excluded'],
    [{ highway: 'construction' }, 'excluded'],
    [{ highway: 'primary' }, 'ride'],
    [{ highway: 'pedestrian' }, 'ride'],
    [{ highway: 'pedestrian', bicycle: 'dismount' }, 'push'],
    [{ highway: 'footway', bicycle: 'designated' }, 'ride'],
    [{ highway: 'footway', footway: 'sidewalk' }, 'excluded'],
    [{ highway: 'footway', footway: 'sidewalk', bicycle: 'yes' }, 'ride'],
    [{ highway: 'footway' }, 'push'],
    [{ highway: 'footway', footway: 'crossing' }, 'push'],
    [{ highway: 'platform' }, 'excluded'],
  ] as const)('%o -> %s', (tags, mode) => {
    expect(bikeAccess(tags)).toBe(mode);
  });
});

describe('rail and carriageway predicates', () => {
  it('carriageways exclude cycleways and footways but keep pedestrian streets', () => {
    expect(isCarriageway({ highway: 'secondary' })).toBe(true);
    expect(isCarriageway({ highway: 'service' })).toBe(true);
    expect(isCarriageway({ highway: 'pedestrian' })).toBe(true);
    expect(isCarriageway({ highway: 'cycleway' })).toBe(false);
    expect(isCarriageway({ highway: 'footway' })).toBe(false);
  });
  it('present rails: tram, disused, disused:railway=tram; abandoned ignored', () => {
    expect(isPresentRail({ railway: 'tram' })).toBe(true);
    expect(isPresentRail({ railway: 'disused' })).toBe(true);
    expect(isPresentRail({ 'disused:railway': 'tram' })).toBe(true);
    expect(isPresentRail({ railway: 'abandoned' })).toBe(false);
    expect(isPresentRail({ railway: 'construction' })).toBe(false);
  });
});
