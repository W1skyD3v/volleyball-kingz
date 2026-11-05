/**
 * Time-to-cosmetic for different kinds of players under the current Gold rules (goldForGame, 100/day cap).
 * Usage: pnpm gold:sim   (prices below are proposals, see docs/design/ECONOMY_AND_RATINGS.md)
 */
import { goldBreakdown } from '@vk/core';

const PRICES = { common: 100, rare: 300, epic: 800, legendary: 2000 } as const;
const ARCHETYPES = [
  { name: 'Light (3 games/week, casual)', gamesPerWeek: 3, rankedShare: 0, maxPerDay: 3 },
  { name: 'Regular (8 games/week, half ranked)', gamesPerWeek: 8, rankedShare: 0.5, maxPerDay: 4 },
  { name: 'Heavy (20 games/week, mostly ranked)', gamesPerWeek: 20, rankedShare: 0.8, maxPerDay: 6 },
  { name: 'Grinder (all day, every day)', gamesPerWeek: 70, rankedShare: 1, maxPerDay: 12 },
];

for (const a of ARCHETYPES) {
  const days: number[] = [];
  // spread games over the week, respecting maxPerDay
  let left = a.gamesPerWeek;
  for (let d = 0; d < 7; d++) {
    const n = Math.min(a.maxPerDay, Math.ceil(left / (7 - d)));
    days.push(n);
    left -= n;
  }
  let weekly = 0;
  let playDays = 0;
  let weeklyPaid = false;
  for (const n of days) {
    if (n > 0) playDays++;
    let earned = 0;
    for (let g = 0; g < n; g++) {
      const ranked = (g + 0.5) / n <= a.rankedShare;
      const weeklyGoalHit = g === 0 && playDays >= 3 && !weeklyPaid;
      const b = goldBreakdown({ lane: ranked ? 'ranked' : 'casual', finalized: true, earnedToday: earned, firstGameOfDay: g === 0, weeklyGoalHit });
      if (b.weekly > 0) weeklyPaid = true;
      earned += b.total;
    }
    weekly += earned;
  }
  const row = Object.entries(PRICES).map(([k, p]) => `${k} ${weekly ? (p / weekly).toFixed(1) : '-'}w`).join(' | ');
  console.log(`${a.name.padEnd(40)} ${String(weekly).padStart(4)} Gold/week  -> weeks to buy: ${row}`);
}
