/* global document, window, getComputedStyle, localStorage */
// Browser smoke test of the web export. Usage: node scripts/web-smoke.mjs  (after `pnpm --filter @vk/mobile export:web`)
// Needs a global Playwright with Chromium (PLAYWRIGHT_BROWSERS_PATH). Not part of `pnpm test`.
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

const browser = await chromium.launch(chromiumOpts);
const ctx = await browser.newContext({
  geolocation: { latitude: 34.0488, longitude: -118.2518, accuracy: 10 },
  permissions: ['geolocation'],
  viewport: { width: 390, height: 844 },
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const results = [];
const check = (name, ok) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`); };

await page.goto(`http://localhost:${port}/`);
await page.getByTestId('name').fill('Smoke');
await page.getByTestId('year').fill('1990');
await page.getByTestId('month').fill('1');
await page.getByTestId('day').fill('1');
await page.getByTestId('continue').click();
await page.getByText('Courts near you').waitFor({ timeout: 15000 });
check('onboarding -> courts', true);
check('adult headcount hides the minor (2 here)', (await page.getByTestId('headcount-c1').innerText()).includes('2 here now'));
await page.getByTestId('checkin-c1').click();
await page.getByText(/Checked in/).first().waitFor({ timeout: 10000 });
check('geolocation check-in', true);
const shot = process.env.SMOKE_SHOT ?? 'apps/mobile/dist/smoke-courts.png';
await page.screenshot({ path: shot });
// Verify the screen by measuring it against an approved baseline (set UPDATE_BASELINE=1 after reviewing an intended change).
const base = 'apps/mobile/e2e-baselines/courts.png';
const cmp = spawnSync('pnpm', ['exec', 'tsx', 'scripts/visual-compare.ts', base, shot, ...(process.env.UPDATE_BASELINE ? ['--update'] : [])], { encoding: 'utf8' });
check('courts screen matches the approved baseline', cmp.status === 0);
if (cmp.status !== 0) results.push('     ' + (cmp.stderr || cmp.stdout).trim());
await page.getByText('Play', { exact: true }).first().click();
await page.getByTestId('start-game').click();
await page.getByTestId('score-A').waitFor({ timeout: 10000 });
await page.getByTestId('claim-A-1').click();
await page.getByTestId('confirm-point').click();
check('live point confirmed -> 1 - 0', `${await page.getByTestId('score-A').innerText()}-${await page.getByTestId('score-B').innerText()}` === '1-0');

// Play the whole game for real: live scoring to 11 (win by 2), both captains confirm every point and the final.
const shots = process.env.SMOKE_SHOTS_DIR;
for (let i = 2; i <= 11; i++) {
  await page.getByTestId('claim-A-1').click();
  await page.getByTestId('confirm-point').click();
  await page.waitForFunction((n) => document.querySelector('[data-testid="score-A"]')?.textContent === String(n), i, { timeout: 5000 });
}
check('11-0 reaches the final confirmation', (await page.getByTestId('status').innerText()).includes('awaiting_final'));
await page.getByTestId('final-A').click();
await page.getByTestId('final-B').click();
await page.getByTestId('gold-award').waitFor({ timeout: 10000 });
check('final: Gold awarded (10 + 10 first game of the day)', (await page.getByTestId('gold-award').innerText()).includes('+20'));
check('final: a casual game is unrated', /Unrated/.test(await page.getByTestId('rating-line').innerText()));
if (shots) await page.screenshot({ path: `${shots}/final.png` });

// Instant replay of the game that was just played: ~7 s a basket, so watch the first one, then skip to the end.
await page.getByTestId('watch-replay').click();
await page.getByTestId('replay-score').waitFor({ timeout: 5000 });
await page.waitForTimeout(4600);
if (shots) await page.screenshot({ path: `${shots}/replay-mid.png` });
await page.waitForFunction(() => /1 : 0/.test(document.querySelector('[data-testid="replay-score"]')?.textContent ?? ''), null, { timeout: 8000 });
check('replay: the first basket goes in after about 7 seconds (1 : 0)', true);
await page.getByTestId('replay-skip').click();
await page.waitForFunction(() => /11 : 0/.test(document.querySelector('[data-testid="replay-score"]')?.textContent ?? ''), null, { timeout: 5000 });
check('replay: skip jumps to the final score 11 : 0', true);
await page.waitForFunction(() => /You won/.test(document.querySelector('[data-testid="replay-step"]')?.textContent ?? ''), null, { timeout: 5000 });
check('replay ends on "You won!"', true);
if (shots) await page.screenshot({ path: `${shots}/replay-end.png` });

// Closet: starter pack, refusal without enough Gold.
await page.getByText('Done', { exact: true }).first().click();
if (shots) await page.screenshot({ path: `${shots}/after-done.png` });
await page.getByRole('tab', { name: 'Closet' }).click(); // a reload would reset the in-memory demo
await page.getByTestId('item-jersey-classic').waitFor({ timeout: 10000 });
check('closet shows the starter jersey as worn', (await page.getByTestId('item-jersey-classic').innerText()).includes('(wearing)'));
check('closet shows the Gold just earned (20)', (await page.getByTestId('closet-gold').innerText()).includes('20'));
await page.getByTestId('buy-head-headband').click();
await page.getByTestId('closet-msg').waitFor({ timeout: 5000 });
check('buying with too little Gold is refused with a clear message', /Not enough Royalty Bucks/.test(await page.getByTestId('closet-msg').innerText()));
check('premium item cannot be bought', (await page.getByTestId('buy-jersey-royal').count()) === 0);
if (shots) await page.screenshot({ path: `${shots}/closet.png`, fullPage: true });
if (shots) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${shots}/closet-top.png` });
  for (const [name, label] of [['runs', 'Runs'], ['play', 'Play'], ['friends', 'Friends'], ['me', 'Me']]) {
    await page.getByRole('tab', { name: label }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${shots}/${name}.png` });
  }
}
// App styles: switching changes the whole look at once and is remembered.
await page.getByRole('tab', { name: 'Me' }).click();
await page.getByTestId('theme-street').click();
await page.waitForTimeout(500);
const lit = await page.evaluate(() => [...document.querySelectorAll('div')].some((d) => getComputedStyle(d).backgroundColor === 'rgb(244, 241, 234)'));
check('app style Street Light changes the page colours', lit);
check('and the choice is remembered', (await page.evaluate(() => localStorage.getItem('vk-theme'))) === 'street');
await page.getByTestId('theme-night').click();
check('no page errors', errors.length === 0);
console.log(results.join('\n'));
if (errors.length) console.log(errors.join('\n'));
await browser.close();
server.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
