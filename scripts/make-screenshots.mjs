// Store screenshots from the real web build with the demo backend, at store sizes. No device, no GPU.
//   node scripts/make-screenshots.mjs            (after `pnpm --filter @vk/mobile export:web`)
// Output: store/screenshots/<set>/NN-name.png  (gitignored; CI uploads them as an artifact)
import { createRequire } from 'node:module';
import http from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

// Prefer the repo's own playwright (CI); fall back to a preinstalled global one (sandbox).
const load = () => { for (const base of [join(process.cwd(), 'scripts/'), process.env.PLAYWRIGHT_NODE_PATH ?? '/opt/node-tools/node_modules/']) { try { return createRequire(base)('playwright'); } catch { /* try next */ } } throw new Error('playwright not found: pnpm install, or set PLAYWRIGHT_NODE_PATH'); };
const { chromium } = load();
const chromiumOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
const root = join(process.cwd(), 'apps/mobile/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  let p = join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(p) || p === root + '/' || !extname(p)) p = join(root, 'index.html');
  res.setHeader('content-type', types[extname(p)] ?? 'application/octet-stream');
  res.end(readFileSync(p));
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

// App Store 6.7" = 1290x2796 (430x932 @3). Play phone = 1080x1920 (360x640 @3).
const SETS = [
  { name: 'ios-67', viewport: { width: 430, height: 932 }, scale: 3 },
  { name: 'android-phone', viewport: { width: 360, height: 640 }, scale: 3 },
];
const browser = await chromium.launch(chromiumOpts);
let count = 0;
for (const set of SETS) {
  const dir = join('store/screenshots', set.name);
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: set.viewport, deviceScaleFactor: set.scale, geolocation: { latitude: 34.0488, longitude: -118.2518, accuracy: 10 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  const shot = async (n, name) => { await page.waitForTimeout(250); await page.screenshot({ path: join(dir, `${String(n).padStart(2, '0')}-${name}.png`) }); count++; };
  await page.goto(url);
  await page.getByTestId('name').fill('Marcus');
  await page.getByTestId('year').fill('1994'); await page.getByTestId('month').fill('6'); await page.getByTestId('day').fill('12');
  await page.getByTestId('continue').click();
  await page.getByText('Courts near you').waitFor();
  await page.getByTestId('checkin-c1').click();
  await page.getByText(/Checked in/).first().waitFor();
  await shot(1, 'courts');
  await page.getByText('Run board', { exact: true }).first().click();
  await page.getByText('Post a run').waitFor();
  await shot(2, 'run-board');
  await page.getByText('Play', { exact: true }).first().click();
  await page.getByTestId('start-game').waitFor();
  await shot(3, 'start-a-game');
  await page.getByTestId('start-game').click();
  await page.getByTestId('claim-A-1').waitFor();
  for (let i = 0; i < 6; i++) { await page.getByTestId('claim-A-1').click(); await page.getByTestId('confirm-point').click(); if (i === 2) await page.getByTestId('claim-B-1').click().then(() => page.getByTestId('confirm-point').click()); }
  await shot(4, 'live-scoring');
  await ctx.close();
}
await browser.close();
server.close();
console.log(`wrote ${count} screenshots to store/screenshots`);
