import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../src/index.js';

const root = resolve(import.meta.dirname, '../../..');
const png = (p: string) => decodePng(readFileSync(join(root, p)));

describe('generated app assets (pnpm assets) are present, correctly sized, and wired into app.json', () => {
  it('store icon is 1024x1024 and fully opaque (App Store rejects transparency)', () => {
    const i = png('apps/mobile/assets/icon.png');
    expect([i.width, i.height]).toEqual([1024, 1024]);
    for (let k = 3; k < i.data.length; k += 4 * 997) expect(i.data[k]).toBe(255);
  });
  it('adaptive icon and splash are 1024x1024 with a transparent background', () => {
    for (const f of ['adaptive-icon.png', 'splash-icon.png']) {
      const i = png(`apps/mobile/assets/${f}`);
      expect([i.width, i.height]).toEqual([1024, 1024]);
      expect(i.data[3]).toBe(0); // top-left pixel transparent
    }
  });
  it('favicon and PWA icons have the sizes the manifest declares', () => {
    expect([png('apps/mobile/assets/favicon.png').width, png('apps/mobile/assets/favicon.png').height]).toEqual([48, 48]);
    const m = JSON.parse(readFileSync(join(root, 'apps/mobile/public/manifest.webmanifest'), 'utf8')) as { icons: { src: string; sizes: string }[]; display: string; start_url: string };
    expect(m.display).toBe('standalone');
    expect(m.icons.length).toBeGreaterThanOrEqual(3);
    for (const ic of m.icons) {
      const img = png(`apps/mobile/public${ic.src}`);
      expect(`${img.width}x${img.height}`).toBe(ic.sizes);
    }
  });
  it('app.json points at files that exist', () => {
    type Cfg = { icon: string; splash: { image: string }; android: { adaptiveIcon: { foregroundImage: string } }; web: { favicon: string } };
    const e = (JSON.parse(readFileSync(join(root, 'apps/mobile/app.json'), 'utf8')) as { expo: Cfg }).expo;
    const files = [e.icon, e.splash.image, e.android.adaptiveIcon.foregroundImage, e.web.favicon];
    for (const f of files) expect(existsSync(join(root, 'apps/mobile', f)), f).toBe(true);
  });
  it('static-host files for the web build exist (SPA fallback and headers)', () => {
    expect(readFileSync(join(root, 'apps/mobile/public/_redirects'), 'utf8')).toMatch(/\/\*\s+\/index\.html\s+200/);
    expect(readFileSync(join(root, 'apps/mobile/public/_headers'), 'utf8')).toMatch(/geolocation=\(self\)/);
  });
});
