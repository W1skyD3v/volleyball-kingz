// Adds the PWA tags to the Expo single-page export (Expo's template ignores app/+html.tsx for output "single").
// Usage: node scripts/postprocess-web.mjs [dist]   (idempotent)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'apps/mobile/dist';
const file = join(dist, 'index.html');
let html = readFileSync(file, 'utf8');

const TAGS = [
  '<link rel="manifest" href="/manifest.webmanifest" />',
  '<link rel="apple-touch-icon" href="/icon-192.png" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
];
html = html.replace(/<meta name="viewport" content="([^"]*)"\s*\/?>/, (m, c) => (c.includes('viewport-fit') ? m : `<meta name="viewport" content="${c}, viewport-fit=cover" />`));
for (const tag of TAGS) if (!html.includes(tag)) html = html.replace('</head>', `  ${tag}\n</head>`);
writeFileSync(file, html);
console.log(`postprocessed ${file}`);
