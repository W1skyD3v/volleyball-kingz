begin;
select * from no_plan();
\set a1 '00000000-0000-0000-0000-0000000000a1'
\set a2 '00000000-0000-0000-0000-0000000000a2'
\set m1 '00000000-0000-0000-0000-0000000000b1'
insert into auth.users (id) values (:'a1'), (:'a2'), (:'m1');
insert into public.profiles (id, display_name, birth_year, is_minor, friend_code, gold_earned) values
  (:'a1', 'Ana', 1990, false, 'ANAANA11', 350), (:'a2', 'Bo', 1985, false, 'BOBOBO22', 5000), (:'m1', 'Kid', 2011, true, 'KIDKID11', 0);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'a1', true);

-- starter pack
select is((public.my_closet()->>'gold')::int, 350, 'closet shows my Gold');
select is(jsonb_array_length(public.my_closet()->'owned'), (select count(*)::int from public.cosmetic_items where starter), 'I own exactly the starter pack');
select is(public.my_closet()->'loadout'->>'jersey', 'jersey-classic', 'starter jersey is worn');
select is(public.my_closet()->'loadout'->>'ball', 'ball-classic', 'starter ball is worn');
select is((select count(*)::int from public.cosmetic_items), 36, 'the catalog is seeded');

-- buying
select is((public.buy_item('jersey-stripe')->>'gold')::int, 250, 'a 100 Gold item costs 100');
select throws_ok($$select public.buy_item('jersey-stripe')$$, 'P0001', 'already_owned', 'cannot buy the same item twice');
select is((public.my_closet()->>'gold')::int, 250, 'a refused purchase leaves the balance alone');
select throws_ok($$select public.buy_item('head-crown')$$, 'P0001', 'not_enough_gold', 'cannot afford a legendary item');
select throws_ok($$select public.buy_item('jersey-royal')$$, 'P0001', 'premium_only', 'premium-only items cannot be bought with Gold');
select throws_ok($$select public.buy_item('nope')$$, 'P0001', 'unknown_item', 'unknown item');
select throws_ok($$select public.buy_item('head-cap')$$, 'P0001', 'not_enough_gold', '250 Gold cannot buy a 300 Gold item');
select is((select sum(amount)::int from public.gold_ledger where user_id = :'a1' and reason like 'purchase:%'), -100, 'the purchase is in the ledger as a negative');

-- equipping
select throws_ok($$select public.equip_item('head-cap')$$, 'P0001', 'not_owned', 'cannot wear what I do not own');
select lives_ok($$select public.equip_item('jersey-stripe')$$, 'I can wear what I own');
select is(public.my_closet()->'loadout'->>'jersey', 'jersey-stripe', 'the new jersey replaced the old one in its slot');
select lives_ok($$select public.equip_item('acc-wristbands')$$, 'wear a starter accessory');
select lives_ok($$select public.unequip_slot('accessory')$$, 'accessories can come off');
select throws_ok($$select public.unequip_slot('jersey')$$, 'P0001', 'cannot_empty', 'but a jersey cannot');
select is(public.my_closet()->'loadout'->>'accessory', null, 'accessory slot is empty');

-- privacy and writes
select throws_ok($$insert into public.user_items (user_id, item_id, source) values ('00000000-0000-0000-0000-0000000000a1', 'head-crown', 'gold')$$, '42501', null, 'clients cannot grant themselves items');
select throws_ok($$update public.profiles set gold_earned = 99999 where id = '00000000-0000-0000-0000-0000000000a1'$$, '42501', null, 'or Gold');
select is((select count(*)::int from public.user_items where user_id = :'a2'), 0, 'I cannot read anyone elses items');

-- Bo (adult) buys something; Ana (adult) can see Bo's loadout, a minor cannot see Bo's
select set_config('request.jwt.claim.sub', :'a2', true);
select lives_ok($$select public.buy_item('head-crown')$$, 'Bo can afford the crown');
select lives_ok($$select public.equip_item('head-crown')$$, 'and wear it');
select set_config('request.jwt.claim.sub', :'a1', true);
select is((select item_id from public.user_loadout where user_id = :'a2' and slot = 'headwear'), 'head-crown', 'adults see what another adult wears');
select set_config('request.jwt.claim.sub', :'m1', true);
select is((select count(*)::int from public.user_loadout where user_id = :'a2'), 1, 'a minor sees an adult loadout exactly as they see an adult profile');
select lives_ok($$select public.my_closet()$$, 'a minor has their own closet');
select set_config('request.jwt.claim.sub', :'a1', true);
select is((select count(*)::int from public.user_loadout where user_id = :'m1'), 0, 'an adult cannot see a minor loadout');

-- anonymous callers get nothing
reset role;
set local role anon;
select throws_ok($$select public.buy_item('jersey-stripe')$$, '42501', null, 'logged-out users cannot buy');
select is((select count(*)::int from public.cosmetic_items), 36, 'but anyone can browse the catalog');
reset role;

-- deletion removes what was owned and worn, keeps the name
select public.scrub_profile(:'a2', true);
select is((select count(*)::int from public.user_items where user_id = :'a2'), 0, 'deleted player owns nothing');
select is((select count(*)::int from public.user_loadout where user_id = :'a2'), 0, 'and wears nothing');
select is((select display_name from public.profiles where id = :'a2'), 'Bo', 'name stays');
select * from finish();
rollback;
