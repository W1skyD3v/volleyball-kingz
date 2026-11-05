import type { CourtType } from './presets.js';

/** Approximate sizes: full court ~420 m2, half ~200 m2. Thresholds sit near the midpoints. */
export const FULL_COURT_M2 = 420;
export const HALF_COURT_M2 = 200;
export const FULL_MIN_M2 = 310;
export const HALF_MIN_M2 = 120;
export const MAX_PLAUSIBLE_M2 = 1200; // bigger than this is probably a multi-court slab or bad polygon

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  /** Present only when fetched with `out geom`. */
  geometry?: { lat: number; lon: number }[];
  /** Present only when fetched with `out bb` / `out geom`. */
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  tags?: Record<string, string>;
}

const M_PER_DEG_LAT = 111_320;

/** Shoelace area of a lat/lon ring in m2 (local equirectangular projection; fine at park scale). */
export function polygonAreaM2(ring: { lat: number; lon: number }[]): number {
  if (ring.length < 3) return 0;
  const lat0 = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
  const kx = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const pts = ring.map((p) => ({ x: p.lon * kx, y: p.lat * M_PER_DEG_LAT }));
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function bboxAreaM2(b: NonNullable<OsmElement['bounds']>): number {
  const lat0 = (b.minlat + b.maxlat) / 2;
  const h = (b.maxlat - b.minlat) * M_PER_DEG_LAT;
  const w = (b.maxlon - b.minlon) * M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  return Math.abs(h * w);
}

export function estimateAreaM2(el: OsmElement): { areaM2: number | null; source: 'geometry' | 'bounds' | 'none' } {
  if (el.geometry && el.geometry.length >= 3) return { areaM2: polygonAreaM2(el.geometry), source: 'geometry' };
  // A bbox overestimates a rotated rectangle, so it is used only when no polygon exists.
  if (el.bounds) return { areaM2: bboxAreaM2(el.bounds), source: 'bounds' };
  return { areaM2: null, source: 'none' };
}

export function classifyArea(areaM2: number | null): CourtType {
  if (areaM2 === null || !Number.isFinite(areaM2) || areaM2 > MAX_PLAUSIBLE_M2) return 'unknown';
  if (areaM2 >= FULL_MIN_M2) return 'full';
  if (areaM2 >= HALF_MIN_M2) return 'half';
  return 'unknown';
}

export interface ImportedCourt {
  osmType: OsmElement['type'];
  osmId: number;
  name: string | null;
  lat: number;
  lng: number;
  courtType: CourtType;
  /** How courtType was decided. 'tag' is only a hint and must be confirmed by a player. */
  typeSource: 'geometry' | 'bounds' | 'tag' | 'none';
  hoops: number | null;
  areaM2: number | null;
  access: string | null;
  indoor: boolean | null;
}

export function normalizeElement(el: OsmElement): ImportedCourt | null {
  const t = el.tags ?? {};
  if (t.leisure !== 'pitch' || t.sport !== 'basketball') return null;
  const g = el.geometry && el.geometry.length > 0 ? el.geometry : null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const lat = el.lat ?? el.center?.lat ?? (el.bounds ? (el.bounds.minlat + el.bounds.maxlat) / 2 : g ? mean(g.map((p) => p.lat)) : undefined);
  const lng = el.lon ?? el.center?.lon ?? (el.bounds ? (el.bounds.minlon + el.bounds.maxlon) / 2 : g ? mean(g.map((p) => p.lon)) : undefined);
  if (lat === undefined || lng === undefined) return null;

  const { areaM2, source } = estimateAreaM2(el);
  let courtType = classifyArea(areaM2);
  let typeSource: ImportedCourt['typeSource'] = source === 'none' ? 'none' : source;
  const hoops = t.hoops !== undefined && /^\d+$/.test(t.hoops) ? Number(t.hoops) : null;
  if (courtType === 'unknown' && source === 'none') {
    // No geometry in the dataset: fall back to the hoops tag as a weak hint.
    if (hoops === 2) { courtType = 'full'; typeSource = 'tag'; }
    else if (hoops === 1) { courtType = 'half'; typeSource = 'tag'; }
  }
  return {
    osmType: el.type,
    osmId: el.id,
    name: t.name ?? null,
    lat,
    lng,
    courtType,
    typeSource,
    hoops,
    areaM2: areaM2 === null ? null : Math.round(areaM2),
    access: t.access ?? null,
    indoor: t.indoor === 'yes' ? true : t.indoor === 'no' ? false : null,
  };
}

/**
 * 5v5 is full court only. An estimated-full court needs one player confirmation
 * before 5v5 can start; the estimate alone is a guess.
 */
export function fullCourtConfirmed(c: { courtType: CourtType; fullConfirmations: number }): boolean {
  return c.courtType === 'full' && c.fullConfirmations >= 1;
}

export function summarize(courts: ImportedCourt[]) {
  const by = (f: (c: ImportedCourt) => string) => {
    const m: Record<string, number> = {};
    for (const c of courts) m[f(c)] = (m[f(c)] ?? 0) + 1;
    return m;
  };
  return {
    total: courts.length,
    byType: by((c) => c.courtType),
    bySource: by((c) => c.typeSource),
    byAccess: by((c) => c.access ?? 'unspecified'),
    named: courts.filter((c) => c.name).length,
  };
}

const NON_PUBLIC_ACCESS = new Set(['private', 'no', 'customers', 'permit']);
/** Courts the app should list. OSM access=private/no/customers/permit are stored but hidden. */
export function isPublicAccess(access: string | null): boolean {
  return access === null || !NON_PUBLIC_ACCESS.has(access);
}

// ---------------------------------------------------------------- clustering into sites

export const CLUSTER_RADIUS_M = 35;

export interface CourtSite extends ImportedCourt {
  /** How many OSM pitches were merged into this site. */
  memberCount: number;
  memberOsmIds: string[]; // "way/123"
}

const accessKey = (a: string | null) => a ?? 'unspecified';

/**
 * Merge pitches within CLUSTER_RADIUS_M into one site. OSM often maps each hoop (or each half) separately, which would
 * split one court's headcount across several rows. Only pitches with the same access value merge, so a private court is
 * never folded into a public one. A site's size: measured geometry wins; otherwise summed hoops (>=2 full, 1 half).
 */
export function clusterCourts(courts: ImportedCourt[], radiusM = CLUSTER_RADIUS_M): CourtSite[] {
  const n = courts.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const cell = radiusM / M_PER_DEG_LAT; // degrees of latitude per cell
  const key = (c: ImportedCourt) => {
    const kx = Math.floor((c.lng * Math.cos((c.lat * Math.PI) / 180)) / cell);
    return [kx, Math.floor(c.lat / cell)] as const;
  };
  const grid = new Map<string, number[]>();
  courts.forEach((c, i) => {
    const [kx, ky] = key(c);
    const k = `${kx},${ky}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  const dist = (a: ImportedCourt, b: ImportedCourt) => {
    const dLat = (a.lat - b.lat) * M_PER_DEG_LAT;
    const dLng = (a.lng - b.lng) * M_PER_DEG_LAT * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
    return Math.hypot(dLat, dLng);
  };
  courts.forEach((c, i) => {
    const [kx, ky] = key(c);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${kx + dx},${ky + dy}`) ?? []) {
          const other = courts[j]!;
          if (j > i && accessKey(other.access) === accessKey(c.access) && dist(c, other) <= radiusM) parent[find(i)] = find(j);
        }
      }
    }
  });

  const groups = new Map<number, ImportedCourt[]>();
  courts.forEach((c, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(c));

  return [...groups.values()].map((m): CourtSite => {
    const rep = [...m].sort((a, b) => (a.osmType + a.osmId).localeCompare(b.osmType + b.osmId))[0]!;
    if (m.length === 1) return { ...rep, memberCount: 1, memberOsmIds: [`${rep.osmType}/${rep.osmId}`] };
    const mean = (f: (c: ImportedCourt) => number) => m.reduce((s, c) => s + f(c), 0) / m.length;
    const hoopsKnown = m.filter((c) => c.hoops !== null);
    const hoops = hoopsKnown.length ? hoopsKnown.reduce((s, c) => s + (c.hoops ?? 0), 0) : null;
    const measured = m.filter((c) => c.typeSource === 'geometry' || c.typeSource === 'bounds').sort((a, b) => (b.areaM2 ?? 0) - (a.areaM2 ?? 0))[0];
    let courtType = measured?.courtType ?? 'unknown';
    let typeSource: ImportedCourt['typeSource'] = measured?.typeSource ?? 'none';
    if (!measured && hoops !== null) {
      courtType = hoops >= 2 ? 'full' : hoops === 1 ? 'half' : 'unknown';
      typeSource = courtType === 'unknown' ? 'none' : 'tag';
    }
    return {
      osmType: rep.osmType,
      osmId: rep.osmId,
      name: m.find((c) => c.name)?.name ?? null,
      lat: mean((c) => c.lat),
      lng: mean((c) => c.lng),
      courtType,
      typeSource,
      hoops,
      areaM2: measured?.areaM2 ?? null,
      access: rep.access,
      indoor: m.find((c) => c.indoor !== null)?.indoor ?? null,
      memberCount: m.length,
      memberOsmIds: m.map((c) => `${c.osmType}/${c.osmId}`).sort(),
    };
  });
}
