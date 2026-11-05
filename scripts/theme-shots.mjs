// Screenshots of the main screens in each app style, for side-by-side review. Usage: node scripts/theme-shots.mjs <out-dir> after export:web.
// Needs Playwright with Chromium. Not part of `pnpm test`.
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';

// Prefer the repo's own playwright (CI); fall back to a preinstalled global one (sandbox).
const load = () => { for (const base of [join(process.cwd(), 'scripts/'), process.env.PLAYWRIGHT_NODE_PATH ?? '/opt/node-tools/node_modules/']) { try { return createRequire(base)('playwright'); } catch { /* try next */ } } throw new Error('playwright not found: pnpm install, or set PLAYWRIGHT_NODE_PATH'); };
const { chromium } = load();
const chromiumOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
const root = join(process.cwd(), 'apps/mobile/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  let p = join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(p) || p === root + '/') p = join(root, 'index.html');
  else if (!extname(p)) p = join(root, 'index.html');
  res.setHeader('content-type', types[extname(p)] ?? 'application/octet-stream');
  res.end(readFileSync(p));
}).listen(0);
const port = server.address().port;

const out = process.argv[2] ?? 'store/themes';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(chromiumOpts);
for (const theme of ['night', 'street', 'royal']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, geolocation: { latitude: 34.0488, longitude: -118.2518 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/?theme=${theme}`);
  await page.getByTestId('name').fill('Smoke');
  await page.getByTestId('year').fill('1990');
  await page.getByTestId('month').fill('1');
  await page.getByTestId('day').fill('1');
  await page.getByTestId('continue').click();
  await page.getByText('Courts near you').waitFor({ timeout: 15000 });
  await page.getByTestId('checkin-c1').click();
  await page.getByText(/Checked in/).first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${out}/${theme}-1-courts.png` });
  await page.getByRole('tab', { name: 'Play' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${theme}-2-play.png` });
  await page.getByTestId('start-game').click();
  await page.getByTestId('score-A').waitFor({ timeout: 10000 });
  await page.getByTestId('claim-A-1').click();
  await page.getByTestId('confirm-point').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${theme}-3-live.png` });
  await page.getByRole('button', { name: /back/i }).first().click().catch(() => undefined);
  await page.goto(`http://localhost:${port}/?theme=${theme}`);
  await ctx.close();
}
await browser.close();
server.close();
