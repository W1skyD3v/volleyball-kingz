/**
 * Renders a contact sheet of one made shot (frames across the 7 seconds) so choreography can be reviewed by eye.
 * Usage: pnpm replay:frames [dunk|three] [dunkStyle|shotStyle] [out.png] [teamSize]
 */
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { defaultAvatarConfig, frameAt, sceneSvg, type Appearance } from '@vk/avatar';
import type { ReplayStep } from '@vk/core';

const kind = (process.argv[2] ?? 'dunk') as 'dunk' | 'three';
const style = process.argv[3] ?? (kind === 'dunk' ? 'two-hand' : 'set');
const out = process.argv[4] ?? `store/replay-${kind}-${style}.png`;
const teamSize = Number(process.argv[5] ?? 2);
const step: ReplayStep = { t: 0, durationMs: 7000, side: 'A', points: kind === 'dunk' ? 1 : 2, shot: kind, scoreA: 1, scoreB: 0, kind: 'basket' };
const cfgA = { ...defaultAvatarConfig('home'), look: { skin: 3, hair: 'short' as const, hairColor: 0, beard: 'none' as const } };
const cfgB = { ...defaultAvatarConfig('away'), look: { skin: 1, hair: 'waves' as const, hairColor: 1, beard: 'stubble' as const }, jersey: { style: 'classic' as const, primary: '#3b82f6', secondary: '#f5f3ee', number: 8 }, shorts: { color: '#1e3a8a' } };
const look = (key: string): Appearance => {
  const away = key.startsWith('defender');
  return { config: away ? cfgB : cfgA, worn: {} };
};
const fracs = [0.04, 0.16, 0.3, 0.46, 0.56, 0.64, 0.72, 0.84];
const W = 720, H = 400, cols = 4;
let cells = '';
fracs.forEach((f, i) => {
  const frame = frameAt(step, { teamSize, styles: kind === 'dunk' ? { dunk: style } : { shot: style } }, f * step.durationMs);
  const svg = sceneSvg(frame, look);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
  const x = (i % cols) * (W + 10), y = Math.floor(i / cols) * (H + 30);
  cells += `<image x="${x}" y="${y + 20}" width="${W}" height="${H}" href="data:image/png;base64,${Buffer.from(png).toString('base64')}"/><text x="${x + 6}" y="${y + 14}" fill="#fff" font-size="14" font-family="sans-serif">${Math.round(f * 7000)} ms · ${frame.caption}</text>`;
});
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * (W + 10)}" height="${2 * (H + 30)}"><rect width="100%" height="100%" fill="#0c0c0e"/>${cells}</svg>`;
mkdirSync('store', { recursive: true });
writeFileSync(out, new Resvg(sheet, { fitTo: { mode: 'width', value: 1800 } }).render().asPng());
console.log(out);
