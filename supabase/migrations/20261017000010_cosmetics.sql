-- Cosmetics: catalog, ownership, loadout, earn-only shop. Gold only; premium-only items cannot be bought (payments are a stub).
-- Nothing here is read by rating code. The seed block below is generated from packages/core/src/cosmetics.ts (pnpm catalog:sql).

create table public.cosmetic_items (
  id text primary key,
  slot text not null check (slot in ('jersey', 'shorts', 'shoes', 'headwear', 'accessory', 'ball', 'celebration', 'dunk', 'shot', 'dribble', 'pass')),
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary')),
  name text not null,
  variant text not null,
  price int not null check (price >= 0),
  starter boolean not null default false,
  premium_only boolean not null default false
);
alter table public.cosmetic_items enable row level security;
create policy cosmetic_items_read on public.cosmetic_items for select to anon, authenticated using (true);

create table public.user_items (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id text not null references public.cosmetic_items (id),
  source text not null check (source in ('starter', 'gold')),
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.user_items enable row level security;
create policy user_items_own on public.user_items for select to authenticated using (user_id = auth.uid());

create table public.user_loadout (
  user_id uuid not null references public.profiles (id) on delete cascade,
  slot text not null,
  item_id text not null references public.cosmetic_items (id),
  primary key (user_id, slot)
);
alter table public.user_loadout enable row level security;
-- Others see what you wear (it is shown in games); who may see you follows the same age-band rules as profiles.
create policy user_loadout_select on public.user_loadout for select to authenticated using (user_id = auth.uid() or public.can_see_user(user_id));

-- BEGIN CATALOG SEED
insert into public.cosmetic_items (id, slot, rarity, name, variant, price, starter, premium_only) values
  ('jersey-classic', 'jersey', 'common', 'Classic jersey', 'classic', 100, true, false),
  ('jersey-stripe', 'jersey', 'common', 'Center stripe jersey', 'stripe', 100, false, false),
  ('jersey-split', 'jersey', 'rare', 'Split jersey', 'split', 300, false, false),
  ('jersey-royal', 'jersey', 'legendary', 'Royal jersey', 'royal', 2000, false, true),
  ('shorts-plain', 'shorts', 'common', 'Plain shorts', 'plain', 100, true, false),
  ('shorts-stripe', 'shorts', 'common', 'Side stripe shorts', 'stripe', 100, false, false),
  ('shoes-low', 'shoes', 'common', 'Low tops', 'low', 100, true, false),
  ('shoes-high', 'shoes', 'common', 'High tops', 'high', 100, false, false),
  ('head-headband', 'headwear', 'common', 'Headband', 'headband', 100, false, false),
  ('head-cap', 'headwear', 'rare', 'Snapback cap', 'cap', 300, false, false),
  ('head-crown', 'headwear', 'legendary', 'Kingz crown', 'crown', 2000, false, false),
  ('acc-wristbands', 'accessory', 'common', 'Wristbands', 'wristbands', 100, true, false),
  ('acc-shades', 'accessory', 'rare', 'Court shades', 'shades', 300, false, false),
  ('acc-chain', 'accessory', 'epic', 'Gold chain', 'chain', 800, false, false),
  ('ball-classic', 'ball', 'common', 'Classic ball', 'classic', 100, true, false),
  ('ball-neon', 'ball', 'rare', 'Neon ball', 'neon', 300, false, false),
  ('ball-gold', 'ball', 'epic', 'Gold ball', 'gold', 800, false, false),
  ('cel-fist', 'celebration', 'common', 'Fist pump', 'fist', 100, true, false),
  ('cel-flex', 'celebration', 'rare', 'Flex', 'flex', 300, false, false),
  ('cel-shimmy', 'celebration', 'epic', 'Shimmy', 'shimmy', 800, false, false),
  ('dunk-two-hand', 'dunk', 'common', 'Two-hand slam', 'two-hand', 100, true, false),
  ('dunk-tomahawk', 'dunk', 'rare', 'Tomahawk', 'tomahawk', 300, false, false),
  ('dunk-windmill', 'dunk', 'epic', 'Windmill', 'windmill', 800, false, false),
  ('dunk-spin', 'dunk', 'legendary', '360 spin dunk', 'spin', 2000, false, false),
  ('shot-set', 'shot', 'common', 'Set shot', 'set', 100, true, false),
  ('shot-fadeaway', 'shot', 'rare', 'Fadeaway', 'fadeaway', 300, false, false),
  ('shot-one-leg', 'shot', 'rare', 'One-leg jumper', 'one-leg', 300, false, false),
  ('shot-stepback', 'shot', 'epic', 'Step-back three', 'stepback', 800, false, false),
  ('dribble-standard', 'dribble', 'common', 'Standard dribble', 'standard', 100, true, false),
  ('dribble-crossover', 'dribble', 'common', 'Crossover', 'crossover', 100, false, false),
  ('dribble-behind', 'dribble', 'rare', 'Behind the back', 'behind', 300, false, false),
  ('dribble-legs', 'dribble', 'epic', 'Between the legs', 'legs', 800, false, false),
  ('pass-chest', 'pass', 'common', 'Chest pass', 'chest', 100, true, false),
  ('pass-bounce', 'pass', 'common', 'Bounce pass', 'bounce', 100, false, false),
  ('pass-behind', 'pass', 'rare', 'Behind-the-back pass', 'behind', 300, false, false),
  ('pass-nolook', 'pass', 'epic', 'No-look pass', 'nolook', 800, false, false);
-- END CATALOG SEED

-- Grants the starter pack (idempotent) and returns {gold, owned, loadout}.
create function public.my_closet() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); out jsonb;
begin
  if uid is null or not public.is_active_user() then raise exception 'not_authenticated'; end if;
  insert into public.user_items (user_id, item_id, source) select uid, id, 'starter' from public.cosmetic_items where starter on conflict do nothing;
  -- Only the first time: a player who took off an accessory must not have it put back on.
  if not exists (select 1 from public.user_loadout where user_id = uid) then
    insert into public.user_loadout (user_id, slot, item_id)
      select distinct on (slot) uid, slot, id from public.cosmetic_items where starter order by slot, id;
  end if;
  select jsonb_build_object(
    'gold', (select gold_earned from public.profiles where id = uid),
    'owned', coalesce((select jsonb_agg(item_id order by item_id) from public.user_items where user_id = uid), '[]'::jsonb),
    'loadout', coalesce((select jsonb_object_agg(slot, item_id) from public.user_loadout where user_id = uid), '{}'::jsonb)
  ) into out;
  return out;
end $$;

-- Spend earned Gold. Errors: unknown_item, premium_only, already_owned, not_enough_gold.
create function public.buy_item(p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); it public.cosmetic_items; left_ int;
begin
  if uid is null or not public.is_active_user() then raise exception 'not_authenticated'; end if;
  select * into it from public.cosmetic_items where id = p_item;
  if not found then raise exception 'unknown_item'; end if;
  if it.premium_only then raise exception 'premium_only'; end if;
  if exists (select 1 from public.user_items where user_id = uid and item_id = it.id) then raise exception 'already_owned'; end if;
  update public.profiles set gold_earned = gold_earned - it.price where id = uid and gold_earned >= it.price returning gold_earned into left_;
  if not found then raise exception 'not_enough_gold'; end if;
  insert into public.gold_ledger (user_id, wallet, amount, reason) values (uid, 'earned', -it.price, 'purchase:' || it.id);
  insert into public.user_items (user_id, item_id, source) values (uid, it.id, 'gold');
  return jsonb_build_object('gold', left_, 'item', it.id);
end $$;

-- Wear an item you own. Errors: unknown_item, not_owned.
create function public.equip_item(p_item text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); it public.cosmetic_items;
begin
  if uid is null or not public.is_active_user() then raise exception 'not_authenticated'; end if;
  select * into it from public.cosmetic_items where id = p_item;
  if not found then raise exception 'unknown_item'; end if;
  if not exists (select 1 from public.user_items where user_id = uid and item_id = it.id) then raise exception 'not_owned'; end if;
  insert into public.user_loadout (user_id, slot, item_id) values (uid, it.slot, it.id)
    on conflict (user_id, slot) do update set item_id = excluded.item_id;
end $$;

-- Take off headwear or an accessory. Required slots cannot be emptied (error cannot_empty).
create function public.unequip_slot(p_slot text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null or not public.is_active_user() then raise exception 'not_authenticated'; end if;
  if p_slot not in ('headwear', 'accessory') then raise exception 'cannot_empty'; end if;
  delete from public.user_loadout where user_id = auth.uid() and slot = p_slot;
end $$;

revoke execute on function public.my_closet(), public.buy_item(text), public.equip_item(text), public.unequip_slot(text) from public, anon;
grant execute on function public.my_closet(), public.buy_item(text), public.equip_item(text), public.unequip_slot(text) to authenticated;

-- Deleting an account removes what the player owned and wore (their name and ranked stats stay, per the Commander).
create or replace function public.scrub_profile(p_user uuid, p_keep_name boolean default true) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.check_ins where user_id = p_user;
  delete from public.runs where host_id = p_user; -- cascades run members and invites
  delete from public.run_members where user_id = p_user;
  delete from public.blocks where blocker_id = p_user;
  delete from public.court_confirmations where user_id = p_user;
  delete from public.tier_usage where user_id = p_user;
  delete from public.gold_ledger where user_id = p_user;
  delete from public.user_items where user_id = p_user;
  delete from public.user_loadout where user_id = p_user;
  delete from public.player_ratings_given where rater_id = p_user;
  delete from public.rating_events where user_id = p_user and kind in ('private_elo', 'casual_elo');
  delete from public.ratings where user_id = p_user and kind in ('private_elo', 'casual_elo');
  delete from public.friendships where requester_id = p_user or addressee_id = p_user;
  update public.reports set reporter_id = null where reporter_id = p_user;
  update public.profiles set
    display_name = case when p_keep_name then display_name else 'Deleted player' end,
    birth_year = null, avatar = null, casual_elo_opt_in = false, gold_earned = 0, gold_bought = 0,
    friend_code = public.gen_friend_code(), deleted_at = coalesce(deleted_at, now())
  where id = p_user; -- is_minor stays so a deleted minor is still never shown to adults
end $$;
revoke execute on function public.scrub_profile(uuid, boolean) from public, anon, authenticated;
