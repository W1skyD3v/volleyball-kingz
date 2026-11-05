/**
 * Sanity check for rating tuning: simulate a league of players with hidden true skill, play random pickup games inside
 * local pods (players mostly meet the same few people), and see how well the ranked rating recovers true skill.
 * Usage: pnpm ratings:sim [players=240] [podSize=24]
 */
import { blendUpdate, displayRating, isProvisional, newSkill, rateRaw, repeatWeight, type SkillRating } from '@vk/core';

const N = Number(process.argv[2] ?? 240);
const POD = Number(process.argv[3] ?? 24);
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

const truth = Array.from({ length: N }, () => gauss());
const rating: SkillRating[] = Array.from({ length: N }, newSkill);
const games = new Array(N).fill(0);
const opps: Set<number>[] = Array.from({ length: N }, () => new Set());
const recent = new Map<string, number>();

function spearman(a: number[], b: number[]) {
  const rank = (x: number[]) => {
    const idx = x.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array(x.length).fill(0);
    idx.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const ra = rank(a), rb = rank(b), n = a.length;
  const m = (n - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - m) * (rb[i] - m); da += (ra[i] - m) ** 2; db += (rb[i] - m) ** 2; }
  return num / Math.sqrt(da * db);
}

function play(tier: 1 | 2, useRepeat: boolean) {
  const pod = Math.floor(rnd() * (N / POD));
  const pool = Array.from({ length: POD }, (_, i) => pod * POD + i);
  const picked: number[] = [];
  while (picked.length < tier * 2) { const p = pool[Math.floor(rnd() * pool.length)]!; if (!picked.includes(p)) picked.push(p); }
  const A = picked.slice(0, tier), B = picked.slice(tier);
  const strength = (t: number[]) => t.reduce((s, i) => s + truth[i]!, 0);
  const pA = 1 / (1 + Math.exp(-(strength(A) - strength(B)) * 1.1));
  const win = rnd() < pA ? 'A' : 'B';
  const raw = rateRaw(A.map((i) => rating[i]!), B.map((i) => rating[i]!), win);
  for (const [team, other, s] of [[A, B, 'A'], [B, A, 'B']] as const) {
    team.forEach((p, k) => {
      const rep = useRepeat ? Math.max(...other.map((o) => recent.get(`${p}-${o}`) ?? 0)) : 0;
      rating[p] = blendUpdate(rating[p]!, raw[s][k]!, repeatWeight(rep, 0), win === s).after;
      games[p]++;
      other.forEach((o) => opps[p]!.add(o));
    });
  }
  for (const a of A) for (const b of B) { recent.set(`${a}-${b}`, (recent.get(`${a}-${b}`) ?? 0) + 1); recent.set(`${b}-${a}`, (recent.get(`${b}-${a}`) ?? 0) + 1); }
}

for (const target of [10, 30, 60, 120]) {
  while (games.reduce((a, b) => a + b, 0) / N < target) play(rnd() < 0.5 ? 1 : 2, true);
  const shown = rating.map((r) => displayRating(r).rating);
  const prov = rating.filter((_, i) => isProvisional({ games: games[i], distinctOpponents: opps[i]!.size })).length;
  const range = rating.reduce((s, r) => s + displayRating(r).range, 0) / N;
  console.log(
    `~${String(target).padStart(3)} games/player: rank correlation with true skill = ${spearman(shown, truth).toFixed(3)}, ` +
      `mean +/- range = ${Math.round(range)}, provisional = ${Math.round((100 * prov) / N)}%, rating spread ${Math.min(...shown)}..${Math.max(...shown)}`,
  );
}
