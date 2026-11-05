export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Default check-in radius around a court centre, metres. */
export const CHECKIN_RADIUS_M = 100;
/** Reported GPS accuracy is credited to the player up to this cap, metres. */
export const MAX_ACCURACY_CREDIT_M = 50;
/** Check-in lifetime, minutes. */
export const CHECKIN_TTL_MIN = 90;

export interface Fix extends LatLng {
  accuracyM?: number | null;
}

export interface CheckInDecision {
  ok: boolean;
  distanceM: number;
  reason: 'ok' | 'too_far' | 'bad_fix';
}

/** Foreground fix vs court centre. Accuracy is credited (capped) so honest users with poor GPS pass. */
export function evaluateCheckIn(fix: Fix, court: LatLng, radiusM = CHECKIN_RADIUS_M): CheckInDecision {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180) {
    return { ok: false, distanceM: Infinity, reason: 'bad_fix' };
  }
  const distanceM = haversineMeters(fix, court);
  const credit = Math.min(Math.max(fix.accuracyM ?? 0, 0), MAX_ACCURACY_CREDIT_M);
  const ok = distanceM - credit <= radiusM;
  return { ok, distanceM, reason: ok ? 'ok' : 'too_far' };
}

export interface CheckIn {
  userId: string;
  courtId: string;
  at: number; // epoch ms
  isMinor: boolean;
}

export function isActive(c: CheckIn, now: number, ttlMin = CHECKIN_TTL_MIN): boolean {
  return now >= c.at && now - c.at < ttlMin * 60_000;
}

export type ViewerAge = 'adult' | 'minor';

/**
 * Check-ins an adult-visible surface may show. Minors are never shown to adults,
 * neither individually nor in headcount (a count of 1 would out them).
 * Minor viewers see other minors and adults.
 */
export function visibleCheckins(all: CheckIn[], viewer: ViewerAge, now: number): CheckIn[] {
  return all.filter((c) => isActive(c, now) && (viewer === 'minor' || !c.isMinor));
}

export function headcountByCourt(all: CheckIn[], viewer: ViewerAge, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  // one live check-in per user: latest wins
  const latest = new Map<string, CheckIn>();
  for (const c of visibleCheckins(all, viewer, now)) {
    const prev = latest.get(c.userId);
    if (!prev || c.at > prev.at) latest.set(c.userId, c);
  }
  for (const c of latest.values()) out[c.courtId] = (out[c.courtId] ?? 0) + 1;
  return out;
}
