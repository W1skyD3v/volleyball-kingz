/**
 * Cosmetic catalog. Source of truth for items; the SQL seed in supabase/migrations is generated from this
 * (`pnpm catalog:sql`) and a test fails on drift. Cosmetics never change rating, matchmaking or any outcome.
 */
export const SLOTS = ['jersey', 'shorts', 'kneepads', 'shoes', 'eyewear', 'accessory', 'ball', 'celebration', 'serve', 'spike', 'set', 'block', 'dive'] as const;
export type Slot = (typeof SLOTS)[number];
/** Slots a player may leave empty. Every other slot always has something equipped. */
export const OPTIONAL_SLOTS: readonly Slot[] = ['kneepads', 'eyewear', 'accessory'];
/** Animation-style slots: how your player moves in replays. */
export const STYLE_SLOTS: readonly Slot[] = ['serve', 'spike', 'set', 'block', 'dive'];

export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];
/** Royalty Bucks prices (internal name: gold). */
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
  { id: 'shorts-board', slot: 'shorts', rarity: 'rare', name: 'Beach board shorts', variant: 'board' },
  { id: 'knee-basic', slot: 'kneepads', rarity: 'common', name: 'Knee pads', variant: 'basic', starter: true },
  { id: 'knee-pro', slot: 'kneepads', rarity: 'rare', name: 'Pro knee pads', variant: 'pro' },
  { id: 'knee-neon', slot: 'kneepads', rarity: 'epic', name: 'Neon knee pads', variant: 'neon' },
  { id: 'shoes-low', slot: 'shoes', rarity: 'common', name: 'Indoor low shoes', variant: 'low', starter: true },
  { id: 'shoes-high', slot: 'shoes', rarity: 'common', name: 'Indoor high shoes', variant: 'high' },
  { id: 'eye-visor', slot: 'eyewear', rarity: 'common', name: 'Sun visor', variant: 'visor' },
  { id: 'eye-shades', slot: 'eyewear', rarity: 'rare', name: 'Beach shades', variant: 'shades' },
  { id: 'eye-mirror', slot: 'eyewear', rarity: 'epic', name: 'Mirror shades', variant: 'mirror' },
  { id: 'acc-sleeves', slot: 'accessory', rarity: 'common', name: 'Arm sleeves', variant: 'sleeves', starter: true },
  { id: 'acc-headband', slot: 'accessory', rarity: 'common', name: 'Headband', variant: 'headband' },
  { id: 'acc-crown', slot: 'accessory', rarity: 'legendary', name: 'Kingz crown', variant: 'crown' },
  { id: 'ball-classic', slot: 'ball', rarity: 'common', name: 'Classic ball', variant: 'classic', starter: true },
  { id: 'ball-beach', slot: 'ball', rarity: 'rare', name: 'Beach ball skin', variant: 'beach' },
  { id: 'ball-neon', slot: 'ball', rarity: 'rare', name: 'Neon ball', variant: 'neon' },
  { id: 'ball-gold', slot: 'ball', rarity: 'epic', name: 'Gold ball', variant: 'gold' },
  { id: 'cel-fist', slot: 'celebration', rarity: 'common', name: 'Fist pump', variant: 'fist', starter: true },
  { id: 'cel-flex', slot: 'celebration', rarity: 'rare', name: 'Flex', variant: 'flex' },
  { id: 'cel-shimmy', slot: 'celebration', rarity: 'epic', name: 'Shimmy', variant: 'shimmy' },
  // Animation styles: how your player moves in replays.
  { id: 'serve-float', slot: 'serve', rarity: 'common', name: 'Float serve', variant: 'float', starter: true },
  { id: 'serve-jump', slot: 'serve', rarity: 'rare', name: 'Jump serve', variant: 'jump' },
  { id: 'serve-power', slot: 'serve', rarity: 'epic', name: 'Power jump serve', variant: 'power' },
  { id: 'spike-standard', slot: 'spike', rarity: 'common', name: 'Standard spike', variant: 'standard', starter: true },
  { id: 'spike-cut', slot: 'spike', rarity: 'rare', name: 'Cut shot', variant: 'cut' },
  { id: 'spike-power', slot: 'spike', rarity: 'epic', name: 'Power swing', variant: 'power' },
  { id: 'spike-spin', slot: 'spike', rarity: 'legendary', name: '360 spike', variant: 'spin' },
  { id: 'set-standard', slot: 'set', rarity: 'common', name: 'Overhead set', variant: 'standard', starter: true },
  { id: 'set-jump', slot: 'set', rarity: 'rare', name: 'Jump set', variant: 'jump' },
  { id: 'set-back', slot: 'set', rarity: 'epic', name: 'Back set', variant: 'back' },
  { id: 'block-standard', slot: 'block', rarity: 'common', name: 'Two-hand block', variant: 'standard', starter: true },
  { id: 'block-swing', slot: 'block', rarity: 'rare', name: 'Swing block', variant: 'swing' },
  { id: 'block-stuff', slot: 'block', rarity: 'epic', name: 'Stuff block', variant: 'stuff' },
  { id: 'dive-standard', slot: 'dive', rarity: 'common', name: 'Dive save', variant: 'standard', starter: true },
  { id: 'dive-roll', slot: 'dive', rarity: 'rare', name: 'Dive and roll', variant: 'roll' },
  { id: 'dive-pancake', slot: 'dive', rarity: 'epic', name: 'Pancake save', variant: 'pancake' },
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
