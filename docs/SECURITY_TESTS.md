# Security and stress testing (2026-11-05)

What was attacked, what was found, what was fixed, and what is still untested. All of this ran against the real stack (Postgres 16 + PostGIS + PostgREST with the real RLS, grants and RPCs) and the real web export in Chromium. Run it yourself:

| Command | What it does |
|---|---|
| `scripts/pentest.sh` (`pnpm security:db`) | 99 attacks as an anonymous visitor, forged tokens, a normal player, a minor, a second player (IDOR), hostile input, races |
| `node scripts/web-security.mjs` (`pnpm security:web`) | The web build served with the real `_headers` (CSP etc.): header checks, secrets in the bundle, a hostile display name, the app running under the CSP |
| `scripts/loadtest.sh` | 200 players, 1,650 real courts, 100 simultaneous games scored to the end |
| `pnpm audit --prod` | Known-vulnerable dependencies |
| `pnpm a11y`, `pnpm devices` | Accessibility (WCAG 2.1 AA, all three app styles) and phone/tablet emulation |

## Findings, all fixed
1. **Age-gate bypass (high).** `create_profile` accepted a client-supplied "today" date, so a child could register as an adult by lying about the date. The server now uses its own date. (Test: a client-supplied `p_today` is refused and no profile is created.)
2. **About 750 PostGIS functions were exposed as public API endpoints (medium).** Installing the extension without a schema put them in `public`, which PostgREST publishes (heavy spatial functions callable by anyone is a denial-of-service lever). PostGIS now lives in its own `extensions` schema; every function pins that path.
3. **Logged-out visitors could execute internal helpers (low).** Everything is now revoked from visitors except the public leaderboard, and internal trigger/code-generator functions are not callable by anyone over the API.
4. **Social-graph leak (medium).** Any signed-in player could ask `are_friends(a, b)` about any two people. It now only answers about yourself.
5. **Unbounded, unvalidated avatar data (medium).** A player's avatar is shown to others, and the column accepted any JSON of any size. The database now rejects anything over 1.5 KB or not in the exact avatar shape, and the app falls back to a default look if it ever meets a bad one.
6. **No Content-Security-Policy (medium).** Added a strict CSP, frame blocking, nosniff, referrer and cross-origin policies. The app was run end to end under it with no violations.

## Held up under attack (selected)
- Anonymous visitors read nothing private from 20 tables, write nothing anywhere, and can call exactly one function.
- Forged, unsigned and expired tokens, and tokens for roles we never granted, get nothing.
- A player cannot change their own Gold, age flag, friend code, id or deletion state, cannot touch other people's rows, and cannot write the tables the server owns (games, ratings, ledger, items, check-ins).
- Another player's game, closet, ledger, friendships, reports and blocks are invisible; a third player cannot score, void, accept or rate someone else's game; side and captaincy come from the token, not the request.
- Adults never see a minor's profile, loadout, check-in or headcount; a minor cannot join an adult run.
- SQL-injection strings, 100 KB inputs, NUL bytes, RTL tricks and format strings in every free-text field never cause a server error or leak; every callable function survives junk arguments (fuzz).
- Races: 25 parallel purchases charge once; three different items with money for one buy only one; 20 simultaneous confirmations of one point count once.
- A deleted account's old token cannot act. Friend-code guessing is throttled; one player cannot auto-hide a run by reporting it repeatedly.
- No secrets, source maps or JWTs in the shipped bundle; a hostile display name (`<svg onload=...>`) renders as plain text and runs nothing.

## The tests were tested
The first draft of this suite passed too easily: some tests read empty tables, one used a response format that forced a permission error on its own, and some called functions that do not exist. All three were fixed (every protected table now has real rows, and a test fails if one is empty), and then nine deliberate regressions were planted one at a time (drop the avatar rule, open a table to visitors, let players write items, bring back the friend oracle, re-allow a client "today", let a minor join a run, expose a helper, open the games table...). All nine are caught.

## Load (this machine, not Supabase)
Courts near me (PostGIS) 519 req/s, p95 165 ms; closet 940 req/s, p95 82 ms; headcounts with 200 check-ins p95 117 ms; 100 games scored to 7 in parallel (1,400 events) p95 77 ms with every game reaching the end of play; no errors. A free Supabase project has much less compute than this box, so treat these as relative numbers.

## Accepted risks and not covered
- **Dependency advisories: 17 (7 high, 6 moderate, 4 low).** Sixteen are in Expo's build tooling (`@expo/cli`: node-forge, glob, minimatch, uuid, deepmerge), which runs on a developer machine and is not shipped in the app. One is `zod` (memory exhaustion when validating huge arrays): we only validate small fixed-shape objects on the client, and the fix needs a major-version upgrade. Revisit with the next Expo SDK upgrade.
- **Not tested:** Supabase Auth itself (email-code rate limits, account enumeration, CAPTCHA), Realtime authorization on a real project, Cloudflare configuration, native iOS/Android builds, denial-of-service at the network edge, social engineering. These need the real accounts.
- **Do when the project exists:** turn on Supabase Auth rate limits and CAPTCHA (Cloudflare Turnstile is free), keep the API's max rows at 1000, enforce SSL, rotate any token that was ever pasted into a chat, and re-run `scripts/pentest.sh` against a staging copy. A lawyer should review privacy and minors' handling; passing tests are not legal compliance.
