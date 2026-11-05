import { describe, expect, it } from 'vitest';
import { ageBand, evaluateCheckIn, haversineMeters, headcountByCourt, visibleCheckins, type CheckIn } from '../src/index.js';

const court = { lat: 34.0522, lng: -118.2437 };

describe('geofence', () => {
  it('haversine: ~111.2 km per degree latitude, zero for same point', () => {
    expect(haversineMeters(court, court)).toBe(0);
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeGreaterThan(111_000);
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeLessThan(111_400);
  });
  it('accepts near, rejects far, credits capped accuracy, rejects bad fixes', () => {
    expect(evaluateCheckIn({ ...court, lat: court.lat + 0.0005 }, court).ok).toBe(true); // ~55 m
    expect(evaluateCheckIn({ ...court, lat: court.lat + 0.002 }, court).ok).toBe(false); // ~222 m
    const edge = { ...court, lat: court.lat + 0.0015 }; // ~167 m
    expect(evaluateCheckIn({ ...edge, accuracyM: 5 }, court).ok).toBe(false);
    expect(evaluateCheckIn({ ...edge, accuracyM: 500 }, court).ok).toBe(false); // credit capped at 50 m
    expect(evaluateCheckIn({ ...edge, accuracyM: 80 }, court).ok).toBe(false);
    expect(evaluateCheckIn({ lat: NaN, lng: 0 }, court).reason).toBe('bad_fix');
  });
});

describe('headcount and minors privacy', () => {
  const now = 10_000_000;
  const mk = (userId: string, isMinor: boolean, at = now - 60_000, courtId = 'c1'): CheckIn => ({ userId, courtId, isMinor, at });
  const all = [mk('a1', false), mk('a2', false), mk('m1', true), mk('old', false, now - 100 * 60_000)];
  it('expires check-ins after the TTL', () => {
    expect(headcountByCourt(all, 'adult', now)).toEqual({ c1: 2 });
  });
  it('never shows minors to adults, even in the count', () => {
    expect(visibleCheckins(all, 'adult', now).some((c) => c.isMinor)).toBe(false);
    expect(headcountByCourt(all, 'adult', now).c1).toBe(2);
  });
  it('minor viewers see everyone active', () => {
    expect(headcountByCourt(all, 'minor', now).c1).toBe(3);
  });
  it('counts a user once, at their latest court', () => {
    const moved = [mk('a1', false, now - 50_000, 'c1'), mk('a1', false, now - 10_000, 'c2')];
    expect(headcountByCourt(moved, 'adult', now)).toEqual({ c2: 1 });
  });
});

describe('age bands', () => {
  const now = new Date('2026-10-16T00:00:00Z');
  it('blocks under 13, minor 13-17, adult 18+', () => {
    expect(ageBand(new Date('2013-10-17T00:00:00Z'), now)).toBe('blocked');
    expect(ageBand(new Date('2013-10-16T00:00:00Z'), now)).toBe('minor');
    expect(ageBand(new Date('2008-10-17T00:00:00Z'), now)).toBe('minor');
    expect(ageBand(new Date('2008-10-16T00:00:00Z'), now)).toBe('adult');
  });
});
