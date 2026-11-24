import { describe, expect, it } from 'vitest';
import {
  bikeAccess,
  classifySurfaceValue,
  classifyWaySurface,
  directionalAccess,
  effectiveSurface,
  hasTaggedRails,
  isCarriageway,
  isPresentRail,
  onewayForBikes,
} from '../src/core/classify.ts';

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
    expect(classifySurfaceValue('graound;grass')).toEqual({ cls: 'UNKNOWN', recognized: false });
  });

  it('multi-valued tags take the worst recognized class', () => {
    expect(classifySurfaceValue('sett;asphalt')).toEqual({ cls: 'PAVE', recognized: true });
    expect(classifySurfaceValue('grass;ground')).toEqual({ cls: 'LOOSE', recognized: true });
  });

  it.each([
    ['milanese_paving', 'PAVE'],
    ['milanese_paving:rails', 'PAVE'],
    ['milanese_paving:lanes', 'PAVE'],
    ['cobblestone:rounded', 'PAVE'],
    ['stone', 'PAVE'],
    ['grass_paver', 'LOOSE'],
    ['woodchips', 'LOOSE'],
    ['wood', 'SMOOTH'],
    ['metal_grid', 'SMOOTH'],
  ] as const)('phase 0 decision 5: %s -> %s', (value, cls) => {
    expect(classifySurfaceValue(value)).toEqual({ cls, recognized: true });
  });
});

describe('classifyWaySurface', () => {
  it('surface_bike=milanese_paving forces PAVE', () => {
    expect(classifyWaySurface({ surface: 'asphalt', surface_bike: 'milanese_paving' }).cls).toBe('PAVE');
  });
  it('any recognized surface_bike takes precedence over surface (decision 4)', () => {
    expect(classifyWaySurface({ surface: 'asphalt', surface_bike: 'sett' }).cls).toBe('PAVE');
    expect(classifyWaySurface({ surface: 'sett', surface_bike: 'asphalt' }).cls).toBe('SMOOTH');
    expect(classifyWaySurface({ surface: 'paving_stones', surface_bike: 'milanese_paving:rails' }).cls).toBe('PAVE');
  });
  it('unrecognized surface_bike falls back to surface but is flagged', () => {
    expect(classifyWaySurface({ surface: 'sett', surface_bike: 'weird' })).toEqual({ cls: 'PAVE', recognized: false });
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

describe('effectiveSurface per direction (§6.2)', () => {
  const tags = { highway: 'secondary', surface: 'sett', 'cycleway:right:surface': 'asphalt' };
  it('right-side lane surface serves the forward direction', () => {
    expect(effectiveSurface(tags, 'forward').cls).toBe('SMOOTH');
    expect(effectiveSurface(tags, 'backward').cls).toBe('PAVE');
  });
  it('left-side lane serves the backward direction; both and plain cycleway:surface serve both', () => {
    expect(effectiveSurface({ surface: 'sett', 'cycleway:left:surface': 'asphalt' }, 'backward').cls).toBe('SMOOTH');
    expect(effectiveSurface({ surface: 'sett', 'cycleway:both:surface': 'asphalt' }, 'forward').cls).toBe('SMOOTH');
    expect(effectiveSurface({ surface: 'sett', 'cycleway:surface': 'paving_stones' }, 'backward').cls).toBe('SLABS');
  });
  it('lane surface beats surface_bike', () => {
    expect(effectiveSurface({ surface: 'asphalt', surface_bike: 'milanese_paving', 'cycleway:right:surface': 'asphalt' }, 'forward').cls).toBe('SMOOTH');
  });
});

describe('tagged rails', () => {
  it('embedded_rails and surface_bike=*:rails mark rails', () => {
    expect(hasTaggedRails({ embedded_rails: 'tram' })).toBe(true);
    expect(hasTaggedRails({ surface_bike: 'milanese_paving:rails' })).toBe(true);
    expect(hasTaggedRails({ surface_bike: 'milanese_paving' })).toBe(false);
  });
});

describe('oneways and contraflow (§6.1)', () => {
  it.each([
    [{ oneway: 'yes' }, 1],
    [{ oneway: '1' }, 1],
    [{ oneway: '-1' }, -1],
    [{ junction: 'roundabout' }, 1],
    [{ oneway: 'yes', 'oneway:bicycle': 'no' }, 0],
    [{ 'oneway:bicycle': 'yes' }, 1],
    [{}, 0],
  ] as const)('%o -> %i', (tags, dir) => {
    expect(onewayForBikes(tags)).toBe(dir);
  });

  it('contraflow on a residential oneway is pushed', () => {
    expect(directionalAccess({ highway: 'residential', oneway: 'yes' })).toEqual({ forward: 'ride', backward: 'push' });
    expect(directionalAccess({ highway: 'tertiary', oneway: '-1' })).toEqual({ forward: 'push', backward: 'ride' });
  });
  it('contraflow is ridden with oneway:bicycle=no or an opposite lane', () => {
    expect(directionalAccess({ highway: 'residential', oneway: 'yes', 'oneway:bicycle': 'no' })).toEqual({ forward: 'ride', backward: 'ride' });
    expect(directionalAccess({ highway: 'residential', oneway: 'yes', cycleway: 'opposite_lane' })).toEqual({ forward: 'ride', backward: 'ride' });
    expect(directionalAccess({ highway: 'secondary', oneway: 'yes', 'cycleway:left': 'lane', 'cycleway:left:oneway': '-1' })).toEqual({ forward: 'ride', backward: 'ride' });
  });
  it('contraflow above tertiary is excluded', () => {
    expect(directionalAccess({ highway: 'primary', oneway: 'yes' })).toEqual({ forward: 'ride', backward: 'excluded' });
  });
  it('pushed ways ignore oneways', () => {
    expect(directionalAccess({ highway: 'footway', oneway: 'yes' })).toEqual({ forward: 'push', backward: 'push' });
  });
});
