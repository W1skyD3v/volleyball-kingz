import { describe, expect, it } from 'vitest';
import {
  PERMIT_NOTE, classifyCourt, clusterCourts, courtFitConfirmed, courtNote, estimateNets, isPublicAccess, normalizeElement, polygonAreaM2,
  type ImportedCourt, type OsmElement,
} from '../src/index.js';

function rect(w: number, h: number) {
  const lat = 34.0;
  const dLat = h / 111_320;
  const dLon = w / (111_320 * Math.cos((lat * Math.PI) / 180));
  const lon = -118.5;
  return [{ lat, lon }, { lat, lon: lon + dLon }, { lat: lat + dLat, lon: lon + dLon }, { lat: lat + dLat, lon }, { lat, lon }];
}
const base: OsmElement = { type: 'way', id: 1, center: { lat: 33.99, lon: -118.47 } };
const tags = (t: Record<string, string>): OsmElement => ({ ...base, tags: { leisure: 'pitch', ...t } });

describe('classification', () => {
  it('beach: sport=beach_volleyball or a sand surface', () => {
    expect(classifyCourt({ sport: 'beach_volleyball' })).toBe('beach');
    expect(classifyCourt({ sport: 'volleyball', surface: 'sand' })).toBe('beach');
    expect(classifyCourt({ sport: 'volleyball;beach_volleyball' })).toBe('beach');
  });
  it('indoor, grass and unknown', () => {
    expect(classifyCourt({ sport: 'volleyball', indoor: 'yes' })).toBe('indoor');
    expect(classifyCourt({ sport: 'volleyball', surface: 'grass' })).toBe('grass');
    expect(classifyCourt({ sport: 'volleyball', surface: 'artificial_turf' })).toBe('grass');
    expect(classifyCourt({ sport: 'volleyball' })).toBe('unknown');
    expect(classifyCourt({ sport: 'volleyball', surface: 'asphalt' })).toBe('unknown');
  });
  it('first match wins: sand beats indoor and grass tags', () => {
    expect(classifyCourt({ sport: 'volleyball', surface: 'sand', indoor: 'yes' })).toBe('beach');
  });
});

describe('normalizeElement', () => {
  it('imports volleyball pitches only (also multi-sport values), not basketball or tennis', () => {
    expect(normalizeElement(tags({ sport: 'volleyball' }))).not.toBeNull();
    expect(normalizeElement(tags({ sport: 'soccer;volleyball' }))).not.toBeNull();
    expect(normalizeElement(tags({ sport: 'beach_volleyball', surface: 'sand' }))).toMatchObject({ courtType: 'beach', typeSource: 'tag', surface: 'sand' });
    expect(normalizeElement(tags({ sport: 'basketball' }))).toBeNull();
    expect(normalizeElement(tags({ sport: 'tennis' }))).toBeNull();
    expect(normalizeElement({ ...base, tags: { sport: 'volleyball' } })).toBeNull(); // not leisure=pitch
    expect(normalizeElement({ type: 'node', id: 3, tags: { leisure: 'pitch', sport: 'volleyball' } })).toBeNull(); // no position
  });
  it('unknown class has typeSource none; named courts keep their name and access', () => {
    expect(normalizeElement(tags({ sport: 'volleyball', name: 'Dockweiler', access: 'yes' }))).toMatchObject({ courtType: 'unknown', typeSource: 'none', name: 'Dockweiler', access: 'yes' });
  });
  it('takes a position from lat/lon, center, bounds or geometry', () => {
    expect(normalizeElement({ type: 'node', id: 9, lat: 34.1, lon: -118.2, tags: { leisure: 'pitch', sport: 'volleyball' } })).toMatchObject({ lat: 34.1, lng: -118.2 });
    expect(normalizeElement({ type: 'way', id: 9, geometry: rect(10, 10), tags: { leisure: 'pitch', sport: 'volleyball' } })?.areaM2).toBe(100);
  });
});

describe('nets', () => {
  it('reads nets, courts and volleyball:nets tags', () => {
    expect(estimateNets({ nets: '4' }, null)).toBe(4);
    expect(estimateNets({ courts: '2' }, null)).toBe(2);
    expect(estimateNets({ 'volleyball:nets': '3' }, null)).toBe(3);
    expect(estimateNets({ nets: 'many' }, 400)).toBe(2); // bad tag -> area estimate
    expect(estimateNets({ nets: '0' }, null)).toBeNull();
    expect(estimateNets({ nets: '99' }, null)).toBeNull();
  });
  it('estimates from area only when plausible', () => {
    expect(estimateNets({}, 128)).toBe(1);
    expect(estimateNets({}, 520)).toBe(2);
    expect(estimateNets({}, 1000)).toBe(4);
    expect(estimateNets({}, 20)).toBeNull();
    expect(estimateNets({}, 9000)).toBeNull();
    expect(estimateNets({}, null)).toBeNull();
  });
  it('polygon area is close to the true value', () => {
    expect(polygonAreaM2(rect(8, 16))).toBeCloseTo(128, 0);
    expect(polygonAreaM2(rect(9, 18))).toBeCloseTo(162, 0);
  });
});

describe('beach permit note and 6v6 fit', () => {
  it('beach courts carry the check hours and permits note; others do not', () => {
    expect(courtNote('beach')).toBe(PERMIT_NOTE);
    expect(PERMIT_NOTE).toMatch(/hours and permits/);
    for (const c of ['indoor', 'grass', 'unknown'] as const) expect(courtNote(c)).toBeNull();
  });
  it('6v6 fit needs an indoor or grass court and one confirmation', () => {
    expect(courtFitConfirmed({ courtType: 'indoor', fitConfirmations: 0 })).toBe(false);
    expect(courtFitConfirmed({ courtType: 'indoor', fitConfirmations: 1 })).toBe(true);
    expect(courtFitConfirmed({ courtType: 'grass', fitConfirmations: 2 })).toBe(true);
    expect(courtFitConfirmed({ courtType: 'beach', fitConfirmations: 3 })).toBe(false);
    expect(courtFitConfirmed({ courtType: 'unknown', fitConfirmations: 3 })).toBe(false);
  });
  it('private access is hidden', () => {
    expect(isPublicAccess(null)).toBe(true);
    expect(isPublicAccess('yes')).toBe(true);
    for (const a of ['private', 'no', 'customers', 'permit']) expect(isPublicAccess(a)).toBe(false);
  });
});

const pitch = (id: number, lat: number, lng: number, o: Partial<ImportedCourt> = {}): ImportedCourt => ({
  osmType: 'node', osmId: id, name: null, lat, lng, courtType: 'beach', typeSource: 'tag', nets: 1, surface: 'sand', areaM2: null, access: null, indoor: null, ...o,
});
describe('clustering into sites', () => {
  it('merges pitches within 35 m of the same access and sums their nets', () => {
    const sites = clusterCourts([pitch(1, 33.9867, -118.4731, { name: 'Venice' }), pitch(2, 33.98672, -118.47312), pitch(3, 33.9900, -118.4731)]);
    expect(sites).toHaveLength(2);
    expect(sites.find((s) => s.memberCount === 2)).toMatchObject({ nets: 2, courtType: 'beach', name: 'Venice', memberOsmIds: ['node/1', 'node/2'] });
  });
  it('never folds a private pitch into a public one', () => {
    expect(clusterCourts([pitch(1, 34, -118), pitch(2, 34.00001, -118, { access: 'private' })])).toHaveLength(2);
  });
  it('a site takes the class most pitches agree on; a tie is unknown', () => {
    const maj = clusterCourts([pitch(1, 34, -118, { courtType: 'grass' }), pitch(2, 34.00001, -118, { courtType: 'grass' }), pitch(3, 34.00002, -118, { courtType: 'beach' })]);
    expect(maj[0]).toMatchObject({ courtType: 'grass', typeSource: 'tag' });
    const tie = clusterCourts([pitch(1, 34, -118, { courtType: 'grass' }), pitch(2, 34.00001, -118, { courtType: 'beach' })]);
    expect(tie[0]).toMatchObject({ courtType: 'unknown', typeSource: 'none' });
    const none = clusterCourts([pitch(1, 34, -118, { courtType: 'unknown', typeSource: 'none', nets: null }), pitch(2, 34.00001, -118, { courtType: 'unknown', typeSource: 'none', nets: null })]);
    expect(none[0]).toMatchObject({ courtType: 'unknown', nets: null });
  });
  it('far-apart pitches stay separate sites', () => {
    expect(clusterCourts([pitch(1, 34, -118), pitch(2, 34.01, -118)])).toHaveLength(2);
  });
});
