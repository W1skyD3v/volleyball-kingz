/**
 * Generates the app icon, adaptive icon, splash, favicon and PWA icons from code (SVG -> PNG with resvg).
 * No image model, no GPU, deterministic: run it anywhere. `pnpm assets`.
 * The mark: a gold crown over a basketball on near-black. No text, so no font dependence.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const BG = '#0e0e10';
const GOLD = '#f5b301';
const GOLD_DARK = '#c48a00';
const BALL = '#ef7d22';
const LINE = '#1b1b1b';

/** The mark on a 1024 canvas. `scale` shrinks it for the Android adaptive-icon safe zone and the splash. */
function mark(scale = 1): string {
  const s = scale;
  const t = (1024 - 1024 * s) / 2;
  return `<g transform="translate(${t} ${t}) scale(${s})">
    <!-- crown -->
    <path d="M300 410 L350 250 L450 340 L512 220 L574 340 L674 250 L724 410 Z" fill="${GOLD}" stroke="${GOLD_DARK}" stroke-width="10" stroke-linejoin="round"/>
    <rect x="300" y="410" width="424" height="36" rx="10" fill="${GOLD_DARK}"/>
    <circle cx="350" cy="250" r="20" fill="${GOLD}"/><circle cx="512" cy="220" r="22" fill="${GOLD}"/><circle cx="674" cy="250" r="20" fill="${GOLD}"/>
    <!-- basketball -->
    <circle cx="512" cy="640" r="210" fill="${BALL}" stroke="${LINE}" stroke-width="14"/>
    <path d="M512 430 V850 M302 640 H722" stroke="${LINE}" stroke-width="12" fill="none"/>
    <path d="M360 495 C430 570 430 710 360 785 M664 495 C594 570 594 710 664 785" stroke="${LINE}" stroke-width="12" fill="none"/>
  </g>`;
}

const svg = (inner: string, bg: string | null = BG, size = 1024) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : ''}${inner}</svg>`;

function png(source: string, width: number): Buffer {
  return Buffer.from(new Resvg(source, { fitTo: { mode: 'width', value: width }, background: undefined }).render().asPng());
}

const out = (process.argv[2] ?? 'apps/mobile/assets').replace(/\/$/, '');
const pub = (process.argv[3] ?? 'apps/mobile/public').replace(/\/$/, '');
mkdirSync(out, { recursive: true });
mkdirSync(pub, { recursive: true });

const files: Record<string, Buffer> = {
  [join(out, 'icon.png')]: png(svg(mark(1)), 1024), // iOS/Android store icon: opaque, full bleed
  [join(out, 'adaptive-icon.png')]: png(svg(mark(0.62), null), 1024), // foreground only; Android crops to ~66% safe zone
  [join(out, 'splash-icon.png')]: png(svg(mark(0.7), null), 1024),
  [join(out, 'favicon.png')]: png(svg(mark(1)), 48),
  [join(pub, 'icon-192.png')]: png(svg(mark(1)), 192),
  [join(pub, 'icon-512.png')]: png(svg(mark(1)), 512),
  [join(pub, 'icon-maskable-512.png')]: png(svg(mark(0.7)), 512), // maskable needs the mark inside the central safe zone
};
for (const [file, buf] of Object.entries(files)) writeFileSync(file, buf);
writeFileSync(join(pub, 'manifest.webmanifest'), JSON.stringify({
  name: 'Volleyball Kingz',
  short_name: 'Kingz',
  description: 'See who is at your court, run it, get rated.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: BG,
  theme_color: BG,
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2) + '\n');
console.log(`wrote ${Object.keys(files).length} images and manifest.webmanifest`);
