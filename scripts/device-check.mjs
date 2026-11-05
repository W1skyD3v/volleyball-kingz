/* global document, window, getComputedStyle */
// Phone and tablet emulation check of the web export (viewport, touch, pixel ratio): no sideways scrolling, tap targets >= 44 px, no console errors, screenshots.
// Emulation in Chromium is not a real device. Usage: node scripts/device-check.mjs [shots-dir] after export:web.
// Needs Playwright with Chromium. Not part of `pnpm test`.
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
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

const shots = process.argv[2];
const DEVICES = [
  ['iPhone SE', { width: 375, height: 667 }, 2],
  ['iPhone 14 Pro Max', { width: 430, height: 932 }, 3],
  ['Pixel 7', { width: 412, height: 915 }, 2.625],
  ['Small Android', { width: 360, height: 640 }, 3],
  ['iPad mini', { width: 768, height: 1024 }, 2],
];
const browser = await chromium.launch(chromiumOpts);
const problems = [];
for (const [name, viewport, dpr] of DEVICES) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, geolocation: { latitude: 34.0488, longitude: -118.2518, accuracy: 10 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${port}/`);
  await page.getByTestId('name').fill('Device');
  await page.getByTestId('year').fill('1990');
  await page.getByTestId('month').fill('1');
  await page.getByTestId('day').fill('1');
  await page.getByTestId('continue').click();
  await page.getByText('Courts near you').waitFor({ timeout: 15000 });
  const screens = [['courts', 'Courts'], ['runs', 'Runs'], ['play', 'Play'], ['friends', 'Friends'], ['closet', 'Closet'], ['me', 'Me']];
  let small = 0;
  let overflow = 0;
  for (const [tabName, tab] of screens) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const over = document.documentElement.scrollWidth > window.innerWidth + 1;
      const tooSmall = [...document.querySelectorAll('[role="button"], button, [role="tab"]')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44) && getComputedStyle(el).visibility !== 'hidden';
      }).map((el) => `${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
      return { over, tooSmall };
    });
    if (m.over) { overflow++; problems.push(`${name} / ${tabName}: sideways scrolling`); }
    small += m.tooSmall.length;
    for (const t of m.tooSmall) problems.push(`${name} / ${tabName}: tap target under 44 px: ${t}`);
    if (shots) await page.screenshot({ path: `${shots}/${name.replace(/\s+/g, '-')}-${tabName}.png` });
  }
  // start a game and score a point to see the live court at this size
  await page.getByRole('tab', { name: 'Play' }).click();
  await page.getByTestId('start-game').click();
  await page.getByTestId('score-A').waitFor({ timeout: 10000 });
  await page.getByTestId('claim-A-1').click();
  await page.getByTestId('confirm-point').click();
  await page.waitForTimeout(500);
  if (shots) await page.screenshot({ path: `${shots}/${name.replace(/\s+/g, '-')}-live.png` });
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (over) problems.push(`${name} / live game: sideways scrolling`);
  if (errors.length) problems.push(`${name}: ${errors.length} console/page error(s): ${errors[0]}`);
  console.log(`${name} ${viewport.width}x${viewport.height}@${dpr}: ${screens.length} tabs + live game, sideways-scroll tabs ${overflow}, small tap targets ${small}, errors ${errors.length}`);
  await ctx.close();
}
if (problems.length) console.log([...new Set(problems)].join('\n'));
await browser.close();
server.close();
process.exit(problems.some((p) => /sideways|error/.test(p)) ? 1 : 0);
