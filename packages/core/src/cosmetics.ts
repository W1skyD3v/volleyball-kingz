/**
 * Cosmetic catalog. Source of truth for items; the SQL seed in supabase/migrations is generated from this
 * (`pnpm catalog:sql`) and a test fails on drift. Cosmetics never change rating, matchmaking or any outcome.
 */
export const SLOTS = ['jersey', 'shorts', 'shoes', 'headwear', 'accessory', 'ball', 'celebration', 'dunk', 'shot', 'dribble', 'pass'] as const;
export type Slot = (typeof SLOTS)[number];
/** Slots a player may leave empty. Every other slot always has something equipped. */
export const OPTIONAL_SLOTS: readonly Slot[] = ['headwear', 'accessory'];

export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];
/** Gold prices (docs/design/ECONOMY_AND_RATINGS.md). */
export const RARITY_PRICE: Record<Rarity, number> = { common: 100, rare: 300, epic: 800, legendary: 2000 };

export interface CosmeticItem {
  id: string;
  slot: Slot;
  rarity: Rarity;
  name: string;
  /** Rendered by the avatar/replay code under this variant name. */
  variant: string;
  /** Everyone owns starter items from the start. */
  starter?: boolean;
  /** Only for the (not yet live) paid shop. Cannot be bought with Gold. */
  premiumOnly?: boolean;
}

export const CATALOG: readonly CosmeticItem[] = [
  { id: 'jersey-classic', slot: 'jersey', rarity: 'common', name: 'Classic jersey', variant: 'classic', starter: true },
  { id: 'jersey-stripe', slot: 'jersey', rarity: 'common', name: 'Center stripe jersey', variant: 'stripe' },
  { id: 'jersey-split', slot: 'jersey', rarity: 'rare', name: 'Split jersey', variant: 'split' },
  { id: 'jersey-royal', slot: 'jersey', rarity: 'legendary', name: 'Royal jersey', variant: 'royal', premiumOnly: true },
  { id: 'shorts-plain', slot: 'shorts', rarity: 'common', name: 'Plain shorts', variant: 'plain', starter: true },
  { id: 'shorts-stripe', slot: 'shorts', rarity: 'common', name: 'Side stripe shorts', variant: 'stripe' },
  { id: 'shoes-low', slot: 'shoes', rarity: 'common', name: 'Low tops', variant: 'low', starter: true },
  { id: 'shoes-high', slot: 'shoes', rarity: 'common', name: 'High tops', variant: 'high' },
  { id: 'head-headband', slot: 'headwear', rarity: 'common', name: 'Headband', variant: 'headband' },
  { id: 'head-cap', slot: 'headwear', rarity: 'rare', name: 'Snapback cap', variant: 'cap' },
  { id: 'head-crown', slot: 'headwear', rarity: 'legendary', name: 'Kingz crown', variant: 'crown' },
  { id: 'acc-wristbands', slot: 'accessory', rarity: 'common', name: 'Wristbands', variant: 'wristbands', starter: true },
  { id: 'acc-shades', slot: 'accessory', rarity: 'rare', name: 'Court shades', variant: 'shades' },
  { id: 'acc-chain', slot: 'accessory', rarity: 'epic', name: 'Gold chain', variant: 'chain' },
  { id: 'ball-classic', slot: 'ball', rarity: 'common', name: 'Classic ball', variant: 'classic', starter: true },
  { id: 'ball-neon', slot: 'ball', rarity: 'rare', name: 'Neon ball', variant: 'neon' },
  { id: 'ball-gold', slot: 'ball', rarity: 'epic', name: 'Gold ball', variant: 'gold' },
  { id: 'cel-fist', slot: 'celebration', rarity: 'common', name: 'Fist pump', variant: 'fist', starter: true },
  { id: 'cel-flex', slot: 'celebration', rarity: 'rare', name: 'Flex', variant: 'flex' },
  { id: 'cel-shimmy', slot: 'celebration', rarity: 'epic', name: 'Shimmy', variant: 'shimmy' },
  // Animation styles: how your player moves in replays.
  { id: 'dunk-two-hand', slot: 'dunk', rarity: 'common', name: 'Two-hand slam', variant: 'two-hand', starter: true },
  { id: 'dunk-tomahawk', slot: 'dunk', rarity: 'rare', name: 'Tomahawk', variant: 'tomahawk' },
  { id: 'dunk-windmill', slot: 'dunk', rarity: 'epic', name: 'Windmill', variant: 'windmill' },
  { id: 'dunk-spin', slot: 'dunk', rarity: 'legendary', name: '360 spin dunk', variant: 'spin' },
  { id: 'shot-set', slot: 'shot', rarity: 'common', name: 'Set shot', variant: 'set', starter: true },
  { id: 'shot-fadeaway', slot: 'shot', rarity: 'rare', name: 'Fadeaway', variant: 'fadeaway' },
  { id: 'shot-one-leg', slot: 'shot', rarity: 'rare', name: 'One-leg jumper', variant: 'one-leg' },
  { id: 'shot-stepback', slot: 'shot', rarity: 'epic', name: 'Step-back three', variant: 'stepback' },
  { id: 'dribble-standard', slot: 'dribble', rarity: 'common', name: 'Standard dribble', variant: 'standard', starter: true },
  { id: 'dribble-crossover', slot: 'dribble', rarity: 'common', name: 'Crossover', variant: 'crossover' },
  { id: 'dribble-behind', slot: 'dribble', rarity: 'rare', name: 'Behind the back', variant: 'behind' },
  { id: 'dribble-legs', slot: 'dribble', rarity: 'epic', name: 'Between the legs', variant: 'legs' },
  { id: 'pass-chest', slot: 'pass', rarity: 'common', name: 'Chest pass', variant: 'chest', starter: true },
  { id: 'pass-bounce', slot: 'pass', rarity: 'common', name: 'Bounce pass', variant: 'bounce' },
  { id: 'pass-behind', slot: 'pass', rarity: 'rare', name: 'Behind-the-back pass', variant: 'behind' },
  { id: 'pass-nolook', slot: 'pass', rarity: 'epic', name: 'No-look pass', variant: 'nolook' },
];

export const itemById = (id: string): CosmeticItem | undefined => CATALOG.find((i) => i.id === id);
export const priceOf = (i: CosmeticItem): number => RARITY_PRICE[i.rarity];
export const starterItems = (): CosmeticItem[] => CATALOG.filter((i) => i.starter);
export type Loadout = Partial<Record<Slot, string>>;

export function defaultLoadout(): Loadout {
  const l: Loadout = {};
  for (const i of starterItems()) if (!l[i.slot]) l[i.slot] = i.id;
  return l;
}

/** Variant name per slot for the renderer. Unknown or empty slots are left out. */
export function wornVariants(l: Loadout): Partial<Record<Slot, string>> {
  const out: Partial<Record<Slot, string>> = {};
  for (const slot of SLOTS) {
    const it = l[slot] ? itemById(l[slot]!) : undefined;
    if (it && it.slot === slot) out[slot] = it.variant;
  }
  return out;
}

export type BuyError = 'unknown_item' | 'premium_only' | 'already_owned' | 'not_enough_gold';
export type EquipError = 'unknown_item' | 'not_owned' | 'cannot_empty';

/** Pure mirror of the SQL buy rules, used by the demo backend and the UI to explain refusals. */
export function checkBuy(id: string, owned: ReadonlySet<string>, gold: number): { ok: true; price: number } | { ok: false; error: BuyError } {
  const it = itemById(id);
  if (!it) return { ok: false, error: 'unknown_item' };
  if (it.premiumOnly) return { ok: false, error: 'premium_only' };
  if (owned.has(id)) return { ok: false, error: 'already_owned' };
  const price = priceOf(it);
  if (gold < price) return { ok: false, error: 'not_enough_gold' };
  return { ok: true, price };
}

export function checkEquip(id: string, owned: ReadonlySet<string>): { ok: true; slot: Slot } | { ok: false; error: EquipError } {
  const it = itemById(id);
  if (!it) return { ok: false, error: 'unknown_item' };
  if (!owned.has(id)) return { ok: false, error: 'not_owned' };
  return { ok: true, slot: it.slot };
}

/** SQL that seeds `cosmetic_items`. Generated, never hand-edited. */
export function catalogSeedSql(): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const rows = CATALOG.map((i) => `  (${q(i.id)}, ${q(i.slot)}, ${q(i.rarity)}, ${q(i.name)}, ${q(i.variant)}, ${priceOf(i)}, ${!!i.starter}, ${!!i.premiumOnly})`);
  return `insert into public.cosmetic_items (id, slot, rarity, name, variant, price, starter, premium_only) values\n${rows.join(',\n')};\n`;
}
