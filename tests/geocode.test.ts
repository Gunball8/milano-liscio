import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Geocoder, type GeoEntryInput, KIND_PLACE, KIND_STREET, parseCoords, serializeGeocoder, splitHouseNumber } from '../src/core/geocode.ts';
import { editDistance, numberVariants, searchKey, stripStreetType } from '../src/core/text.ts';

describe('search text helpers', () => {
  it('searchKey folds case, accents, apostrophes and punctuation', () => {
    expect(searchKey("Basilica di Sant'Ambrogio")).toBe('basilica di sant ambrogio');
    expect(searchKey('  Piazzale  Medaglie d’Oro ')).toBe('piazzale medaglie d oro');
    expect(searchKey('Città Studi')).toBe('citta studi');
  });
  it('street types can be left out', () => {
    expect(stripStreetType('via torino')).toBe('torino');
    expect(stripStreetType('via privata ercole marelli')).toBe('ercole marelli');
    expect(stripStreetType('piazzale loreto')).toBe('loreto');
    expect(stripStreetType('torino')).toBeNull();
    expect(stripStreetType('via')).toBeNull();
  });
  it('day numbers before a month exist in digits, words and Roman numerals', () => {
    expect(numberVariants('piazza ventiquattro maggio')).toEqual(expect.arrayContaining(['piazza 24 maggio', 'piazza xxiv maggio']));
    expect(numberVariants('corso xxii marzo')).toEqual(expect.arrayContaining(['corso 22 marzo', 'corso ventidue marzo']));
    expect(numberVariants('piazza cinque giornate')).toContain('piazza 5 giornate');
    expect(numberVariants('via pio xi')).toEqual([]);
  });
  it('edit distance with transpositions and an early stop', () => {
    expect(editDistance('magneta', 'magenta', 1)).toBe(1);
    expect(editDistance('torino', 'torino', 1)).toBe(0);
    expect(editDistance('magneta', 'lodi', 1)).toBe(2); // max + 1: too far
  });
  it('parses coordinates and house numbers', () => {
    expect(parseCoords('45.4642, 9.19')).toEqual({ lat: 45.4642, lon: 9.19 });
    expect(parseCoords('45.4642 9.19')).toEqual({ lat: 45.4642, lon: 9.19 });
    expect(parseCoords('via torino')).toBeNull();
    expect(splitHouseNumber('via torino 12')).toEqual({ text: 'via torino', number: '12' });
    expect(splitHouseNumber('viale monza 140b')).toEqual({ text: 'viale monza', number: '140b' });
    expect(splitHouseNumber('corso xxii marzo')).toEqual({ text: 'corso xxii marzo', number: null });
  });
});

describe('geocoder on a small index', () => {
  const entries: GeoEntryInput[] = [
    { kind: KIND_STREET, name: 'Via Torino', sub: 'Municipio 1', lon: 9.18, lat: 45.46, weight: 2, keys: ['via torino', 'torino'], numbers: [{ n: '10', lon: 9.181, lat: 45.461 }, { n: '15', lon: 9.182, lat: 45.462 }] },
    { kind: KIND_STREET, name: 'Corso Magenta', sub: 'Municipio 1', lon: 9.17, lat: 45.46, weight: 2, keys: ['corso magenta', 'magenta'], numbers: [] },
    { kind: KIND_PLACE, name: 'Milano Centrale', sub: 'Gare', lon: 9.2, lat: 45.48, weight: 3, keys: ['milano centrale', 'stazione centrale', 'centrale'], numbers: [] },
  ];
  const g = new Geocoder(serializeGeocoder(entries, { builtAt: '', osmBase: null }).buffer as ArrayBuffer);
  it('round-trips through the binary format', () => {
    expect(g.entryCount).toBe(3);
  });
  it('finds exact numbers and falls back to the nearest one on the same side', () => {
    const exact = g.search('via torino 10')[0]!;
    expect(exact).toMatchObject({ kind: 'address', label: 'Via Torino 10', lon: 9.181 });
    expect(exact.approximate).toBeUndefined();
    const near = g.search('torino 12')[0]!;
    expect(near).toMatchObject({ kind: 'address', approximate: true, lon: 9.181 }); // 10, same parity as 12
    const odd = g.search('torino 13')[0]!;
    expect(odd).toMatchObject({ approximate: true, lon: 9.182 }); // 15
  });
  it('street without known numbers gives its midpoint, flagged approximate', () => {
    expect(g.search('corso magenta 5')[0]).toMatchObject({ kind: 'address', approximate: true, lon: 9.17 });
  });
  it('tolerates typos and prefixes, and never matches unrelated words', () => {
    expect(g.search('corso magneta')[0]?.label).toBe('Corso Magenta');
    expect(g.search('stazione cent')[0]?.label).toBe('Milano Centrale');
    expect(g.search('corso lodi')).toEqual([]);
  });
});

const BIN = path.resolve(import.meta.dirname, '../public/data/milano-geocoder.bin');

describe.skipIf(!existsSync(BIN))('geocoder on the Milan index (SPEC §9.1)', () => {
  const buf = readFileSync(BIN);
  const g = new Geocoder(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const first = (q: string) => g.search(q, 5)[0];
  it.each([
    ['Via Torino', 'Via Torino'],
    ['torino', 'Via Torino'],
    ['VIA TORINO', 'Via Torino'],
    ['corso magneta', 'Corso Magenta'],
    ['corso buen', 'Corso Buenos Aires'],
    ['piazza xxiv maggio', 'Piazza Ventiquattro Maggio'],
    ['24 maggio', 'Piazza Ventiquattro Maggio'],
    ['xxii marzo', 'Corso Ventidue Marzo'],
    ['stazione centrale', 'Milano Centrale'],
    ['basilica sant ambrogio', "Basilica di Sant'Ambrogio"],
    ['medaglie d oro', "Piazzale Medaglie d'Oro"],
    ['citta studi', undefined],
  ])('%s → %s', (q, label) => {
    const r = first(q);
    if (label) expect(r?.label).toBe(label);
    else expect(r).toBeDefined();
  });
  it('Via Torino in Milan comes before its namesakes in neighbouring towns', () => {
    expect(first('via torino')?.sublabel).toBe('Municipio 1');
  });
  it('house numbers: exact when mapped', () => {
    const r = first('viale monza 140')!;
    expect(r.kind).toBe('address');
    expect(r.approximate).toBeUndefined();
  });
});
