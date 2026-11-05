import { describe, expect, it } from 'vitest';
import { CATALOG, OPTIONAL_SLOTS, RARITY_PRICE, SLOTS, STYLE_SLOTS, wornVariants, checkBuy, checkEquip, defaultLoadout, itemById, priceOf } from '../src/cosmetics.js';

describe('catalog', () => {
  it('has unique ids, valid slots, and a starter item for every required slot', () => {
    expect(new Set(CATALOG.map((i) => i.id)).size).toBe(CATALOG.length);
    for (const s of SLOTS.filter((s) => !OPTIONAL_SLOTS.includes(s))) expect(CATALOG.some((i) => i.slot === s && i.starter)).toBe(true);
  });
  it('prices follow rarity: 100 / 300 / 800 / 2000', () => {
    expect(RARITY_PRICE).toEqual({ common: 100, rare: 300, epic: 800, legendary: 2000 });
    expect(priceOf(itemById('acc-crown')!)).toBe(2000);
  });
  it('has the five animation styles (serve, spike, set, block, dive) each with a free starter and paid upgrades', () => {
    expect([...STYLE_SLOTS]).toEqual(['serve', 'spike', 'set', 'block', 'dive']);
    for (const slot of STYLE_SLOTS) {
      expect(CATALOG.filter((i) => i.slot === slot && i.starter)).toHaveLength(1);
      expect(CATALOG.filter((i) => i.slot === slot && !i.starter).length).toBeGreaterThanOrEqual(2);
    }
  });
  it('covers the volleyball gear: knee pads, indoor shoes, visors and sunglasses, ball skins', () => {
    const names = CATALOG.map((i) => i.name.toLowerCase()).join('|');
    for (const w of ['knee pads', 'indoor', 'visor', 'shades', 'ball']) expect(names).toContain(w);
    expect(CATALOG.some((i) => /basket|dunk|hoop/i.test(i.name + i.id))).toBe(false);
  });
  it('wornVariants maps a loadout to renderer variants', () => {
    expect(wornVariants({ jersey: 'jersey-split', serve: 'serve-jump' })).toEqual({ jersey: 'split', serve: 'jump' });
  });
  it('starter loadout fills every required slot', () => {
    const l = defaultLoadout();
    for (const s of SLOTS.filter((s) => !OPTIONAL_SLOTS.includes(s))) expect(l[s]).toBeTruthy();
  });
});

describe('buy and equip rules', () => {
  const owned = new Set(['jersey-classic']);
  it('refuses unknown, premium-only, owned and unaffordable items', () => {
    expect(checkBuy('nope', owned, 999)).toEqual({ ok: false, error: 'unknown_item' });
    expect(checkBuy('jersey-royal', owned, 99999)).toEqual({ ok: false, error: 'premium_only' });
    expect(checkBuy('jersey-classic', owned, 999)).toEqual({ ok: false, error: 'already_owned' });
    expect(checkBuy('knee-pro', owned, 299)).toEqual({ ok: false, error: 'not_enough_gold' });
  });
  it('allows an affordable item at exactly its price', () => {
    expect(checkBuy('knee-pro', owned, 300)).toEqual({ ok: true, price: 300 });
  });
  it('equips only owned items', () => {
    expect(checkEquip('knee-pro', owned)).toEqual({ ok: false, error: 'not_owned' });
    expect(checkEquip('jersey-classic', owned)).toEqual({ ok: true, slot: 'jersey' });
  });
});
