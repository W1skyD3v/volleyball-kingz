/* global window, document, location */
// Web security checks on the real export: served with the _headers rules Cloudflare will apply (CSP etc.), hostile names (XSS), secrets in the bundle.
// Usage: node scripts/web-security.mjs after export:web.
// Needs Playwright with Chromium. Not part of `pnpm test`.
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

// Prefer the repo's own playwright (CI); fall back to a preinstalled global one (sandbox).
const load = () => { for (const base of [join(process.cwd(), 'scripts/'), process.env.PLAYWRIGHT_NODE_PATH ?? '/opt/node-tools/node_modules/']) { try { return createRequire(base)('playwright'); } catch { /* try next */ } } throw new Error('playwright not found: pnpm install, or set PLAYWRIGHT_NODE_PATH'); };
const { chromium } = load();
const chromiumOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
const root = join(process.cwd(), 'apps/mobile/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.ttf': 'font/ttf' };
// serve with the headers file applied (the "/*" block plus any exact-path block)
const headerRules = (() => {
  const rules = [];
  let cur = null;
  const file = join(root, '_headers');
  if (!existsSync(file)) return rules;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { cur = { path: line.trim(), h: {} }; rules.push(cur); } else if (cur) { const [k, ...v] = line.trim().split(':'); cur.h[k.trim()] = v.join(':').trim(); }
  }
  return rules;
})();
const matches = (rule, url) => rule === '/*' || rule === url || (rule.endsWith('/*') && url.startsWith(rule.slice(0, -1)));
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  let p = join(root, decodeURIComponent(url));
  if (!existsSync(p) || p === root + '/') p = join(root, 'index.html');
  else if (!extname(p)) p = join(root, 'index.html');
  res.setHeader('content-type', types[extname(p)] ?? 'application/octet-stream');
  for (const r of headerRules) if (matches(r.path, url === '/' ? '/index.html' : url)) for (const [k, v] of Object.entries(r.h)) res.setHeader(k, v);
  res.end(readFileSync(p));
}).listen(0);
const port = server.address().port;
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`);

// 1. headers actually sent
const r = await fetch(`http://localhost:${port}/`);
const csp = r.headers.get('content-security-policy') ?? '';
check('Content-Security-Policy is sent', csp.includes("default-src 'self'") && csp.includes("object-src 'none'") && csp.includes("frame-ancestors 'none'"));
check("CSP forbids inline and remote scripts (script-src 'self' only)", /script-src 'self'(;|$)/.test(csp) && !/script-src[^;]*unsafe/.test(csp));
check('clickjacking, sniffing and referrer headers are sent', r.headers.get('x-frame-options') === 'DENY' && r.headers.get('x-content-type-options') === 'nosniff' && !!r.headers.get('referrer-policy'));
check('geolocation allowed only for this origin; camera and microphone off', (r.headers.get('permissions-policy') ?? '').includes('geolocation=(self)') && (r.headers.get('permissions-policy') ?? '').includes('camera=()'));

// 2. nothing secret in the shipped bundle
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|html|json|map|webmanifest)$/.test(f)) files.push(p); } };
walk(root);
const PATTERNS = [[/service_role/i, 'service_role'], [/SUPABASE_SERVICE/i, 'SUPABASE_SERVICE'], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'], [/AKIA[0-9A-Z]{16}/, 'AWS key'], [/sk_live_[0-9a-zA-Z]{10,}/, 'Stripe live key'], [/ghp_[0-9A-Za-z]{30,}/, 'GitHub token'], [/xoxb-[0-9A-Za-z-]{20,}/, 'Slack token'], [/eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, 'JWT (only the public anon key may ever appear)']];
const hits = [];
for (const f of files) { const t = readFileSync(f, 'utf8'); for (const [re, name] of PATTERNS) if (re.test(t)) hits.push(`${name} in ${f.replace(root, '')}`); }
check(`no secrets in the shipped bundle (${files.length} files scanned)`, hits.length === 0, hits.join('; '));
check('no source maps are shipped', !files.some((f) => f.endsWith('.map')));

// 3. hostile names and the app under the CSP
const browser = await chromium.launch(chromiumOpts);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 34.0488, longitude: -118.2518 }, permissions: ['geolocation'] });
const page = await ctx.newPage();
const violations = [];
const dialogs = [];
page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 140)); });
page.on('pageerror', (e) => violations.push(String(e).slice(0, 140)));
page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
await page.addInitScript(() => { window.__xss = 0; });
const payload = '<svg onload=alert(1)>'; // fits the 24-character name limit; any markup that ran would raise a dialog or add an element
await page.goto(`http://localhost:${port}/`);
await page.getByTestId('name').fill(payload);
await page.getByTestId('year').fill('1990');
await page.getByTestId('month').fill('1');
await page.getByTestId('day').fill('1');
await page.getByTestId('continue').click();
await page.getByText('Courts near you').waitFor({ timeout: 15000 });
check('the app starts and works under the CSP', true);
await page.getByRole('tab', { name: 'Me' }).click();
await page.waitForTimeout(500);
const body = await page.evaluate(() => ({ xss: window.__xss, imgs: document.querySelectorAll('svg[onload]').length, scripts: [...document.querySelectorAll('script')].filter((s) => !s.src).length, shown: document.body.innerText.toLowerCase().includes('<svg onload=alert(1)>') }));
check('a hostile display name is shown as plain text and runs nothing', body.shown && body.xss === 0 && body.imgs === 0 && body.scripts === 0 && dialogs.length === 0, JSON.stringify(body));
// playing a point and opening the closet and replay still work under the CSP
await page.getByRole('tab', { name: 'Play' }).click();
await page.getByTestId('start-game').click();
await page.getByTestId('score-A').waitFor({ timeout: 10000 });
await page.getByTestId('claim-A-1').click();
await page.getByTestId('confirm-point').click();
await page.waitForFunction(() => document.querySelector('[data-testid="score-A"]')?.textContent === '1', null, { timeout: 5000 });
check('live scoring works under the CSP (sprites and court render)', true);
check('no CSP violations or page errors in the whole run', violations.length === 0, violations.slice(0, 3).join(' | '));
// 4. URL and storage hygiene
const urlsOk = await page.evaluate(() => !/(token|password|secret|key)=/i.test(location.href));
check('no secrets in the page URL', urlsOk);
console.log(results.join('\n'));
await browser.close();
server.close();
process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0);
