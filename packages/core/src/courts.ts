import type { CourtType } from './presets.js';

/** Reference playing-court sizes (not including run-off): indoor 9 x 18 m, beach 8 x 16 m. */
export const INDOOR_COURT_M2 = 162;
export const BEACH_COURT_M2 = 128;
/** One net with its run-off space takes roughly this much ground; used only to estimate a net count from geometry. */
export const NET_SPACING_M2 = 250;
export const MIN_PLAUSIBLE_M2 = 60;
export const MAX_PLAUSIBLE_M2 = 2500; // bigger than this is probably a multi-court slab or a bad polygon

/** Shown in court detail for beach courts. Data only: the app never books or checks anything. */
export const PERMIT_NOTE =
  'Check hours and permits before you go. Public beach courts can have posted hours, reservations or permit rules that this app cannot see.';

export function courtNote(courtType: CourtType): string | null {
  return courtType === 'beach' ? PERMIT_NOTE : null;
}

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

const SAND_SURFACES = new Set(['sand', 'beach', 'dirt;sand', 'sand;grass']);
const GRASS_SURFACES = new Set(['grass', 'grass_paver', 'turf', 'artificial_turf', 'astroturf']);

const sportsOf = (t: Record<string, string>): string[] => (t.sport ?? '').split(';').map((x) => x.trim().toLowerCase());
export const isVolleyballTags = (t: Record<string, string>): boolean => {
  const sp = sportsOf(t);
  return t.leisure === 'pitch' && (sp.includes('volleyball') || sp.includes('beach_volleyball'));
};

/** Court class from OSM tags alone (first match wins). Area is not used: indoor and beach areas overlap once run-off is counted. */
export function classifyCourt(t: Record<string, string>): CourtType {
  const surface = (t.surface ?? '').toLowerCase();
  if (sportsOf(t).includes('beach_volleyball') || SAND_SURFACES.has(surface)) return 'beach';
  if (t.indoor === 'yes' || t.location === 'indoor') return 'indoor';
  if (GRASS_SURFACES.has(surface)) return 'grass';
  return 'unknown';
}

/** Net count: from tags when present (nets, courts, volleyball:nets), else estimated from measured area, else null. */
export function estimateNets(t: Record<string, string>, areaM2: number | null): number | null {
  for (const k of ['nets', 'courts', 'volleyball:nets']) {
    const v = t[k];
    if (v !== undefined && /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 30) return Number(v);
  }
  if (areaM2 !== null && Number.isFinite(areaM2) && areaM2 >= MIN_PLAUSIBLE_M2 && areaM2 <= MAX_PLAUSIBLE_M2) return Math.max(1, Math.round(areaM2 / NET_SPACING_M2));
  return null;
}

export interface ImportedCourt {
  osmType: OsmElement['type'];
  osmId: number;
  name: string | null;
  lat: number;
  lng: number;
  courtType: CourtType;
  /** How courtType was decided: 'tag' (OSM tags; a player can still confirm) or 'none' (unknown). */
  typeSource: 'tag' | 'none';
  nets: number | null;
  surface: string | null;
  areaM2: number | null;
  access: string | null;
  indoor: boolean | null;
}

export function normalizeElement(el: OsmElement): ImportedCourt | null {
  const t = el.tags ?? {};
  if (!isVolleyballTags(t)) return null;
  const g = el.geometry && el.geometry.length > 0 ? el.geometry : null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const lat = el.lat ?? el.center?.lat ?? (el.bounds ? (el.bounds.minlat + el.bounds.maxlat) / 2 : g ? mean(g.map((p) => p.lat)) : undefined);
  const lng = el.lon ?? el.center?.lon ?? (el.bounds ? (el.bounds.minlon + el.bounds.maxlon) / 2 : g ? mean(g.map((p) => p.lon)) : undefined);
  if (lat === undefined || lng === undefined) return null;
  const { areaM2 } = estimateAreaM2(el);
  const courtType = classifyCourt(t);
  return {
    osmType: el.type,
    osmId: el.id,
    name: t.name ?? null,
    lat,
    lng,
    courtType,
    typeSource: courtType === 'unknown' ? 'none' : 'tag',
    nets: estimateNets(t, areaM2),
    surface: t.surface ?? null,
    areaM2: areaM2 === null ? null : Math.round(areaM2),
    access: t.access ?? null,
    indoor: t.indoor === 'yes' ? true : t.indoor === 'no' ? false : null,
  };
}

/**
 * 6v6 needs an indoor or grass court AND at least one player confirmation: a tag is only a hint
 * (same idea as Basketball Kingz's "5v5 needs a confirmed full court"). 2v2 and 4v4 never need it.
 */
export function courtFitConfirmed(c: { courtType: CourtType; fitConfirmations: number }): boolean {
  return (c.courtType === 'indoor' || c.courtType === 'grass') && c.fitConfirmations >= 1;
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
    withNets: courts.filter((c) => c.nets !== null).length,
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
 * never folded into a public one. A site's class is the class most of its pitches agree on (a tie is unknown); its nets are the sum of the known counts.
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
    const netsKnown = m.filter((c) => c.nets !== null);
    const nets = netsKnown.length ? netsKnown.reduce((s, c) => s + (c.nets ?? 0), 0) : null;
    const votes = new Map<CourtType, number>();
    for (const c of m) if (c.courtType !== 'unknown') votes.set(c.courtType, (votes.get(c.courtType) ?? 0) + 1);
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const courtType: CourtType = ranked.length === 0 || (ranked.length > 1 && ranked[0]![1] === ranked[1]![1]) ? 'unknown' : ranked[0]![0];
    const sized = [...m].sort((a, b) => (b.areaM2 ?? 0) - (a.areaM2 ?? 0))[0];
    return {
      osmType: rep.osmType,
      osmId: rep.osmId,
      name: m.find((c) => c.name)?.name ?? null,
      lat: mean((c) => c.lat),
      lng: mean((c) => c.lng),
      courtType,
      typeSource: courtType === 'unknown' ? 'none' : 'tag',
      nets,
      surface: m.find((c) => c.surface !== null)?.surface ?? null,
      areaM2: sized?.areaM2 ?? null,
      access: rep.access,
      indoor: m.find((c) => c.indoor !== null)?.indoor ?? null,
      memberCount: m.length,
      memberOsmIds: m.map((c) => `${c.osmType}/${c.osmId}`).sort(),
    };
  });
}
