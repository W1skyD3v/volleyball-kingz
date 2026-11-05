import { describe, expect, it } from 'vitest';
import { CATALOG, OPTIONAL_SLOTS, RARITY_PRICE, SLOTS, checkBuy, checkEquip, defaultLoadout, itemById, priceOf } from '../src/cosmetics.js';

describe('catalog', () => {
  it('has unique ids, valid slots, and a starter item for every required slot', () => {
    expect(new Set(CATALOG.map((i) => i.id)).size).toBe(CATALOG.length);
    for (const s of SLOTS.filter((s) => !OPTIONAL_SLOTS.includes(s))) expect(CATALOG.some((i) => i.slot === s && i.starter)).toBe(true);
  });
  it('prices follow rarity: 100 / 300 / 800 / 2000', () => {
    expect(RARITY_PRICE).toEqual({ common: 100, rare: 300, epic: 800, legendary: 2000 });
    expect(priceOf(itemById('head-crown')!)).toBe(2000);
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
    expect(checkBuy('head-cap', owned, 299)).toEqual({ ok: false, error: 'not_enough_gold' });
  });
  it('allows an affordable item at exactly its price', () => {
    expect(checkBuy('head-cap', owned, 300)).toEqual({ ok: true, price: 300 });
  });
  it('equips only owned items', () => {
    expect(checkEquip('head-cap', owned)).toEqual({ ok: false, error: 'not_owned' });
    expect(checkEquip('jersey-classic', owned)).toEqual({ ok: true, slot: 'jersey' });
  });
});
