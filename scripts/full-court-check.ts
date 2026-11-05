/**
 * Full-court check: estimate pitch area from geometry and flag full | half | unknown.
 * Usage: pnpm courts:fullcheck [input.json] [--query]
 *   --query  print the Overpass QL that returns geometry (run it yourself, politely; see OSM Overpass usage policy).
 *
 * The committed LA dataset has only `center` for ways (no geometry), so area cannot be computed
 * from it; those courts are flagged from the hoops tag as a hint (typeSource=tag) or `unknown`.
 */
import { summarize } from '@vk/core';
import { loadCourts } from './lib.js';

if (process.argv.includes('--query')) {
  console.log(`[out:json][timeout:300];
area["name"="Los Angeles County"]["boundary"="administrative"]->.a;
(way(area.a)["leisure"="pitch"]["sport"="basketball"];)->.w;
.w out geom tags;
// nodes and relations: add node(area.a)[...]; and relation(area.a)[...]; with out center tags;`);
  process.exit(0);
}

const input = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'data/osm_la_county_basketball_pitches.json';
const { courts, skipped } = loadCourts(input);
const s = summarize(courts);
const withArea = courts.filter((c) => c.areaM2 !== null);
console.log(JSON.stringify({ input, skipped, ...s, withMeasuredArea: withArea.length }, null, 2));
if (withArea.length === 0) {
  console.log('\nNo geometry in this file: area-based flags impossible. Re-fetch with `pnpm courts:fullcheck --query`.');
}
