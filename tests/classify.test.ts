import { describe, expect, it } from 'vitest';
import {
  barrierBlocksBikes,
  classifySurfaceValue,
  classifyWaySurface,
  directionalAccess,
  effectiveSurface,
  hasTaggedRails,
  isCarriageway,
  isPresentRail,
  wayAccess,
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

describe('wayAccess: pedestrian rules, bike physics (2026-11-25)', () => {
  it.each([
    [{ highway: 'motorway' }, 'excluded'],
    [{ highway: 'trunk' }, 'excluded'],
    [{ highway: 'trunk', bicycle: 'yes' }, 'ride'],
    [{ highway: 'trunk', foot: 'no', bicycle: 'no' }, 'excluded'],
    [{ highway: 'primary', foot: 'no', bicycle: 'no' }, 'excluded'],
    [{ highway: 'primary', foot: 'no' }, 'ride'],
    [{ highway: 'residential', bicycle: 'no' }, 'ride'],
    [{ highway: 'service', access: 'private' }, 'excluded'],
    [{ highway: 'service', access: 'private', foot: 'yes' }, 'ride'],
    [{ highway: 'service', access: 'no', bicycle: 'yes' }, 'ride'],
    [{ highway: 'steps' }, 'excluded'],
    [{ highway: 'steps', 'ramp:bicycle': 'yes' }, 'ride'],
    [{ highway: 'construction' }, 'excluded'],
    [{ highway: 'primary' }, 'ride'],
    [{ highway: 'pedestrian' }, 'ride'],
    [{ highway: 'pedestrian', bicycle: 'dismount' }, 'ride'],
    [{ highway: 'footway' }, 'ride'],
    [{ highway: 'footway', footway: 'sidewalk' }, 'ride'],
    [{ highway: 'footway', footway: 'crossing' }, 'ride'],
    [{ highway: 'footway', foot: 'private' }, 'excluded'],
    [{ highway: 'cycleway', foot: 'no' }, 'ride'],
    [{ highway: 'path', bicycle: 'no' }, 'ride'],
    [{ highway: 'platform' }, 'excluded'],
    [{ highway: 'corridor' }, 'excluded'],
  ] as const)('%o -> %s', (tags, mode) => {
    expect(wayAccess(tags)).toBe(mode);
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

describe('directions (pedestrian rules)', () => {
  it('oneways apply to neither direction', () => {
    expect(directionalAccess({ highway: 'residential', oneway: 'yes' })).toEqual({ forward: 'ride', backward: 'ride' });
    expect(directionalAccess({ highway: 'primary', oneway: '-1' })).toEqual({ forward: 'ride', backward: 'ride' });
    expect(directionalAccess({ highway: 'secondary', junction: 'roundabout' })).toEqual({ forward: 'ride', backward: 'ride' });
  });
  it('an excluded way is excluded both ways', () => {
    expect(directionalAccess({ highway: 'motorway', oneway: 'yes' })).toEqual({ forward: 'excluded', backward: 'excluded' });
  });
});

describe('barriers (audit 2026-11-25)', () => {
  it.each([
    [{ barrier: 'gate', access: 'private' }, true],
    [{ barrier: 'gate', access: 'no' }, true],
    [{ barrier: 'gate', locked: 'yes' }, true],
    [{ barrier: 'lift_gate', bicycle: 'no' }, false],
    [{ barrier: 'gate', foot: 'no', bicycle: 'no' }, true],
    [{ barrier: 'gate', access: 'private', foot: 'yes' }, false],
    [{ barrier: 'gate', locked: 'yes', foot: 'yes' }, true],
    [{ barrier: 'kissing_gate' }, true],
    [{ barrier: 'gate', access: 'private', bicycle: 'yes' }, false],
    [{ barrier: 'gate' }, false],
    [{ barrier: 'gate', access: 'customers' }, false],
    [{ barrier: 'turnstile' }, true],
    [{ barrier: 'bollard' }, false],
    [{ barrier: 'cycle_barrier' }, false],
    [{ barrier: 'kerb' }, false],
  ] as const)('%o blocks bikes: %s', (tags, blocked) => {
    expect(barrierBlocksBikes(tags)).toBe(blocked);
  });
});
