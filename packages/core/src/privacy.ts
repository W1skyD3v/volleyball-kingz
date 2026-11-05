export type AgeBand = 'blocked' | 'minor' | 'adult';

export function ageOn(birthDate: Date, now: Date): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const m = now.getUTCMonth() - birthDate.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birthDate.getUTCDate())) age--;
  return age;
}

/** Draft build is 13+ only. Under-13 is blocked (no under-13 accounts). */
export function ageBand(birthDate: Date, now: Date = new Date()): AgeBand {
  const a = ageOn(birthDate, now);
  if (a < 13) return 'blocked';
  return a < 18 ? 'minor' : 'adult';
}
