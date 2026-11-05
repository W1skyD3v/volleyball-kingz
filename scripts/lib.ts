import { readFileSync } from 'node:fs';
import { clusterCourts, normalizeElement, type CourtSite, type ImportedCourt, type OsmElement } from '@vk/core';

export function loadCourts(path: string): { courts: ImportedCourt[]; skipped: number } {
  return loadRaw(path);
}

export function loadSites(path: string): { sites: CourtSite[]; pitches: number; skipped: number } {
  const { courts, skipped } = loadRaw(path);
  return { sites: clusterCourts(courts), pitches: courts.length, skipped };
}

function loadRaw(path: string): { courts: ImportedCourt[]; skipped: number } {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { elements: OsmElement[] };
  const courts: ImportedCourt[] = [];
  let skipped = 0;
  for (const el of raw.elements) {
    const c = normalizeElement(el);
    if (c) courts.push(c);
    else skipped++;
  }
  return { courts, skipped };
}
