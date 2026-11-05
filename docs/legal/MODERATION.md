# Moderation runbook (draft)

## What the system does automatically
- A run is **hidden** when 3 different players report it, or immediately when any report is marked "I feel unsafe" (safety escalation). The host still sees it. A moderator can restore it.
- Blocked users are invisible to each other (profiles, runs, headcount).
- Games untouched for 24 hours (including frozen disputes) and lobbies untouched for 2 hours are voided by `pg_cron` inside the database every 15 minutes (`pnpm moderation expire` runs it by hand).
- When a game becomes final, the database flags the same two players meeting 5+ times in ranked within 7 days (`integrity_flags`, kind `repeat_pairing`). Other flags: `impossible_travel`, `dispute_void`.

## Daily routine
1. `pnpm moderation list` (needs `DATABASE_URL` with the service role). Safety escalations print first with `!!`.
2. Safety escalation: review within [TARGET, e.g. 1 hour while the app has users]. If someone may be in danger, [ESCALATION CONTACT/PROCESS].
3. Decide: close (`pnpm moderation close <id>`), restore a wrongly hidden run (`pnpm moderation restore-run <id>`), or remove/ban the account (not built: manual SQL for now).
4. Look at integrity flags. Repeated flags on the same account: review its games, void them, reset its rating.

## Not built yet
Moderator web UI, ban/suspend flow, appeals, automated text filtering, retention rules for reports. Needed before scale.
