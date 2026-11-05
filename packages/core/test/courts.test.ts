import { describe, expect, it } from 'vitest';
import { classifyArea, fullCourtConfirmed, normalizeElement, polygonAreaM2, type OsmElement } from '../src/index.js';

// A rectangle of w x h metres near LA.
function rect(w: number, h: number) {
  const lat = 34.05;
  const dLat = h / 111_320;
  const dLon = w / (111_320 * Math.cos((lat * Math.PI) / 180));
  const lon = -118.25;
  return [
    { lat, lon }, { lat, lon: lon + dLon }, { lat: lat + dLat, lon: lon + dLon }, { lat: lat + dLat, lon }, { lat, lon },
  ];
}

describe('court area', () => {
  it('computes polygon area close to the true value', () => {
    expect(polygonAreaM2(rect(28, 15))).toBeCloseTo(420, 0);
  });
  it('classifies full ~420, half ~200, tiny/huge/null as unknown', () => {
    expect(classifyArea(420)).toBe('full');
    expect(classifyArea(200)).toBe('half');
    expect(classifyArea(40)).toBe('unknown');
    expect(classifyArea(5000)).toBe('unknown');
    expect(classifyArea(null)).toBe('unknown');
  });
  it('normalizes a way with geometry using area, not tags', () => {
    const el: OsmElement = { type: 'way', id: 1, geometry: rect(28, 15), tags: { leisure: 'pitch', sport: 'basketball', hoops: '1' } };
    const c = normalizeElement(el)!;
    expect(c.courtType).toBe('full');
    expect(c.typeSource).toBe('geometry');
    expect(c.areaM2).toBe(420);
  });
  it('falls back to hoops tag as a hint when there is no geometry', () => {
    const base = { type: 'way' as const, id: 2, center: { lat: 34, lon: -118 } };
    expect(normalizeElement({ ...base, tags: { leisure: 'pitch', sport: 'basketball', hoops: '2' } })).toMatchObject({ courtType: 'full', typeSource: 'tag' });
    expect(normalizeElement({ ...base, tags: { leisure: 'pitch', sport: 'basketball', hoops: '1' } })).toMatchObject({ courtType: 'half', typeSource: 'tag' });
    expect(normalizeElement({ ...base, tags: { leisure: 'pitch', sport: 'basketball' } })).toMatchObject({ courtType: 'unknown', typeSource: 'none' });
  });
  it('skips non-basketball and elements without coordinates', () => {
    expect(normalizeElement({ type: 'node', id: 3, lat: 1, lon: 1, tags: { leisure: 'pitch', sport: 'tennis' } })).toBeNull();
    expect(normalizeElement({ type: 'way', id: 4, tags: { leisure: 'pitch', sport: 'basketball' } })).toBeNull();
  });
  it('5v5 needs an estimated-full court AND a player confirmation', () => {
    expect(fullCourtConfirmed({ courtType: 'full', fullConfirmations: 0 })).toBe(false);
    expect(fullCourtConfirmed({ courtType: 'full', fullConfirmations: 1 })).toBe(true);
    expect(fullCourtConfirmed({ courtType: 'half', fullConfirmations: 3 })).toBe(false);
  });
});

import { clusterCourts, type ImportedCourt } from '../src/index.js';

const pitch = (id: number, lat: number, lng: number, over: Partial<ImportedCourt> = {}): ImportedCourt => ({
  osmType: 'node', osmId: id, name: null, lat, lng, courtType: 'half', typeSource: 'tag', hoops: 1, areaM2: null, access: null, indoor: null, ...over,
});

describe('clusterCourts', () => {
  it('merges two one-hoop nodes ~20 m apart into one full-court site (estimate)', () => {
    const sites = clusterCourts([pitch(1, 33.9268247, -118.3444556), pitch(2, 33.9266477, -118.3444567)]);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ memberCount: 2, hoops: 2, courtType: 'full', typeSource: 'tag' });
  });
  it('keeps far-apart pitches separate', () => {
    expect(clusterCourts([pitch(1, 34.0, -118.0), pitch(2, 34.01, -118.0)])).toHaveLength(2);
  });
  it('never folds a private pitch into a public one', () => {
    const sites = clusterCourts([pitch(1, 34.0, -118.0), pitch(2, 34.00005, -118.0, { access: 'private' })]);
    expect(sites).toHaveLength(2);
  });
  it('chains transitive neighbours and takes the first name', () => {
    const sites = clusterCourts([pitch(1, 34.0, -118.0), pitch(2, 34.0002, -118.0, { name: 'Rec Park' }), pitch(3, 34.0004, -118.0)]);
    expect(sites).toHaveLength(1);
    expect(sites[0]!.name).toBe('Rec Park');
    expect(sites[0]!.memberOsmIds).toEqual(['node/1', 'node/2', 'node/3']);
  });
  it('measured geometry beats summed hoops', () => {
    const sites = clusterCourts([
      pitch(1, 34.0, -118.0, { courtType: 'half', typeSource: 'geometry', areaM2: 200 }),
      pitch(2, 34.0001, -118.0, { hoops: 1 }),
    ]);
    expect(sites[0]).toMatchObject({ courtType: 'half', typeSource: 'geometry' });
  });
});
