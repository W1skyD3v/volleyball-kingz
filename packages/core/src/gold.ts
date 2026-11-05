/**
 * AON Gold. Earn-only in the draft. Two wallets exist in the data model (earned, bought) but
 * the bought wallet is a stub: nothing credits it and nothing here is read by rating code.
 */
export interface Wallet {
  earned: number;
  bought: number;
}

export const DAILY_EARN_CAP = 100;
export const GOLD_FIRST_GAME_BONUS = 10;
export const GOLD_WEEKLY_GOAL = 50;

export interface GoldInput {
  lane: 'casual' | 'private' | 'ranked';
  finalized: boolean;
  /** Gold already earned today (spending does not reduce it). */
  earnedToday: number;
  /** This is the player's first confirmed game of the UTC day. */
  firstGameOfDay?: boolean;
  /** This game completes the week's goal (3 distinct play days) and it has not been paid yet. */
  weeklyGoalHit?: boolean;
}

export interface GoldBreakdown {
  game: number;
  firstGame: number;
  weekly: number;
  total: number;
}

/** Gold for completing a confirmed game: base, then first-game bonus, then weekly goal, each limited by what is left of the daily cap. */
export function goldBreakdown(i: GoldInput): GoldBreakdown {
  if (!i.finalized) return { game: 0, firstGame: 0, weekly: 0, total: 0 };
  let left = Math.max(0, DAILY_EARN_CAP - i.earnedToday);
  const take = (want: number) => {
    const got = Math.min(want, left);
    left -= got;
    return got;
  };
  const game = take(i.lane === 'ranked' ? 15 : 10);
  const firstGame = i.firstGameOfDay ? take(GOLD_FIRST_GAME_BONUS) : 0;
  const weekly = i.weeklyGoalHit ? take(GOLD_WEEKLY_GOAL) : 0;
  return { game, firstGame, weekly, total: game + firstGame + weekly };
}

export const goldForGame = (i: GoldInput): number => goldBreakdown(i).total;

/** Purchases are out of scope. Interface only; the stub always refuses. */
export interface PurchaseProvider {
  listProducts(): Promise<{ sku: string; priceLabel: string }[]>;
  purchase(sku: string): Promise<{ ok: boolean }>;
}

export const stubPurchaseProvider: PurchaseProvider = {
  async listProducts() {
    return [];
  },
  async purchase() {
    throw new Error('Purchases are not available in this build');
  },
};

export function canSpend(w: Wallet, price: number, currency: keyof Wallet): boolean {
  return w[currency] >= price;
}
