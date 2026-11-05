// Accessibility audit (axe-core, WCAG 2.1 A/AA) of every tab in the web export. Usage: node scripts/a11y-audit.mjs after export:web.
// Needs Playwright with Chromium. Not part of `pnpm test`.
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

// Prefer the repo's own playwright (CI); fall back to a preinstalled global one (sandbox).
const load = () => { for (const base of [join(process.cwd(), 'scripts/'), process.env.PLAYWRIGHT_NODE_PATH ?? '/opt/node-tools/node_modules/']) { try { return createRequire(base)('playwright'); } catch { /* try next */ } } throw new Error('playwright not found: pnpm install, or set PLAYWRIGHT_NODE_PATH'); };
const { chromium } = load();
const AxeBuilder = createRequire(join(process.cwd(), 'scripts/'))('@axe-core/playwright').default;
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
const THEME = process.env.THEME ?? 'night';
await page.goto(`http://localhost:${port}/?theme=${THEME}`);
await page.getByTestId('name').fill('Audit');
await page.getByTestId('year').fill('1990');
await page.getByTestId('month').fill('1');
await page.getByTestId('day').fill('1');
await page.getByTestId('continue').click();
await page.getByText('Courts near you').waitFor({ timeout: 15000 });
const out = [];
for (const [name, tab] of [['courts', 'Courts'], ['runs', 'Runs'], ['play', 'Play'], ['friends', 'Friends'], ['closet', 'Closet'], ['me', 'Me']]) {
  await page.getByRole('tab', { name: tab }).click();
  await page.waitForTimeout(700);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  for (const v of r.violations) out.push(`${name}: [${v.impact}] ${v.id} x${v.nodes.length} - ${v.help}`);
  console.log(`[${THEME}] ${name}: ${r.violations.length} violation type(s), ${r.passes.length} rules passed`);
}
console.log(out.join('\n'));
await browser.close();
server.close();
process.exit(out.some((l) => /\[(serious|critical)\]/.test(l)) ? 1 : 0);
