/** Renders a gallery of avatar looks and gear to a PNG for eyeballing a change. Usage: pnpm avatar:gallery [out.png] */
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { defaultAvatarConfig, renderAvatarSvg, type AvatarConfig } from '@vk/avatar';
const mk = (look: AvatarConfig['look'], extra: Partial<AvatarConfig> = {}): AvatarConfig => ({ ...defaultAvatarConfig('x'), look, ...extra });
const list: [AvatarConfig, object][] = [
  [mk({ skin: 2, hair: 'short', hairColor: 0, beard: 'none' }), {}],
  [mk({ skin: 4, hair: 'waves', hairColor: 0, beard: 'goatee' }, { jersey: { style: 'stripe', primary: '#ef4444', secondary: '#f5f3ee', number: 7 } }), { headwear: 'headband', accessory: 'wristbands', shorts: 'stripe' }],
  [mk({ skin: 1, hair: 'afro', hairColor: 1, beard: 'stubble' }, { jersey: { style: 'split', primary: '#3b82f6', secondary: '#111827', number: 11 }, shoes: { style: 'high', color: '#f5b301' } }), { accessory: 'shades', shoes: 'high' }],
  [mk({ skin: 5, hair: 'locs', hairColor: 0, beard: 'full' }, { jersey: { style: 'classic', primary: '#4c1d95', secondary: '#f5b301', number: 23 } }), { jersey: 'royal', headwear: 'crown', accessory: 'chain' }],
  [mk({ skin: 0, hair: 'bun', hairColor: 3, beard: 'none' }, { jersey: { style: 'classic', primary: '#22c55e', secondary: '#0c0c0e', number: 3 } }), { headwear: 'cap' }],
  [mk({ skin: 3, hair: 'buzz', hairColor: 5, beard: 'full' }, { jersey: { style: 'classic', primary: '#f97316', secondary: '#111827', number: 99 } }), {}],
];
const inner = list.map(([c, w], i) => `<g transform="translate(${i * 400},0)">${renderAvatarSvg(c, w as never).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="620" viewBox="0 0 2400 620"><rect width="2400" height="620" fill="#17171b"/>${inner}</svg>`;
mkdirSync('store', { recursive: true });
writeFileSync(process.argv[2] ?? 'store/avatar-gallery.png', new Resvg(svg, { fitTo: { mode: 'width', value: 1800 } }).render().asPng());
