import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { compareImages } from '../src/index.js';

function img(w: number, h: number, fill: [number, number, number] = [14, 14, 16]): PNG {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) p.data.set([...fill, 255], i * 4);
  return p;
}
function rect(p: PNG, x0: number, y0: number, w: number, h: number, c: [number, number, number]) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) p.data.set([...c, 255], (y * p.width + x) * 4);
}

describe('visual comparison', () => {
  it('identical images pass with zero change', () => {
    const r = compareImages(img(100, 100), img(100, 100));
    expect(r).toMatchObject({ ok: true, changedPixels: 0, significantCells: 0 });
  });
  it('anti-aliasing noise below the channel tolerance is ignored', () => {
    const a = img(100, 100);
    const b = img(100, 100, [20, 18, 22]); // +6 per channel everywhere
    expect(compareImages(a, b).ok).toBe(true);
  });
  it('a few stray changed pixels do not fail (region-significance floor)', () => {
    const a = img(120, 120);
    const b = img(120, 120);
    for (let i = 0; i < 6; i++) b.data.set([255, 255, 255, 255], (i * 7 * 120 + i * 11) * 4); // scattered pixels
    const r = compareImages(a, b);
    expect(r.changedPixels).toBeGreaterThan(0);
    expect(r.ok).toBe(true);
  });
  it('a real change (a moved or recoloured block) fails and says where', () => {
    const a = img(200, 200);
    const b = img(200, 200);
    rect(b, 50, 80, 60, 30, [245, 179, 1]); // a gold button appeared
    const r = compareImages(a, b);
    expect(r.ok).toBe(false);
    expect(r.significantCells).toBeGreaterThan(0);
    expect(r.box!.x).toBeLessThanOrEqual(50);
    expect(r.box!.x + r.box!.w).toBeGreaterThanOrEqual(110);
    expect(r.box!.y).toBeLessThanOrEqual(80);
  });
  it('different sizes fail outright', () => {
    expect(compareImages(img(100, 100), img(100, 101))).toMatchObject({ ok: false, sizeMismatch: true });
  });
  it('the allowance is configurable', () => {
    const a = img(200, 200);
    const b = img(200, 200);
    rect(b, 0, 0, 30, 30, [255, 0, 0]);
    expect(compareImages(a, b).ok).toBe(false);
    expect(compareImages(a, b, { maxSignificantCells: 10 }).ok).toBe(true);
  });
});
