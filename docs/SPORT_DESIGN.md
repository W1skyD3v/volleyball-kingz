# Volleyball Kingz: sport design

Status: written before any code (2026-11-05), updated as the build teaches us things. Source engine: Basketball Kingz `draft/phase1`
(commit e90dda2). Decisions that go beyond the brief are also logged in `docs/DECISIONS.md`; real questions in `docs/OPEN_QUESTIONS.md`.

`W1skyD3v/pickleball-kingz` exists but is empty (no commits), so there was nothing to reuse from it.

## 1. Formats

Internal name stays `tier` (= players per side) so the sport-neutral engine, tables and RPCs keep their shape. Player-facing copy says "format".

| Format (`tier`) | Name | Default surface | Default match | Notes |
|---|---|---|---|---|
| 2 | Beach 2v2 | sand | 21, win by 2, best of 3 | side switches every 7 (5 in the deciding set) |
| 4 | 4v4 | grass or sand | 21, win by 2, best of 3 | |
| 6 | Indoor 6v6 | indoor or grass | 25, win by 2, best of 3 | rotation matters most here |

- One rating per format (2, 4, 6). Surface does not split the pool (4v4 on sand and on grass are the same pool). Coed is a label on a run, never a pool.
- Casual pickup default: one set to 11, win by 2.
- Court fit (`canPlayFormatOnCourt`): 2v2 and 4v4 on any court; **6v6 needs an `indoor` or `grass` court with at least one player confirmation** (same mechanism as basketball's "5v5 needs a confirmed full court"). A mapped beach court (8 x 16 m) is too small for 6v6.

## 2. Scoring

**Rally scoring always**: every rally gives exactly one point to its winner. There is no point-less side-out.

### Set rules (one `SetRule`)
- Target: 11 (casual), 15, 21 (beach default), 25 (indoor default).
- Win by 2 (default) or win by 1.
- Optional **hard cap**, only offered with win by 2: the first side to reach `target + 5` wins even by one point (25 -> 30, 21 -> 26, 15 -> 20, 11 -> 16).
- Win condition for a set at `(a, b)`: `hi >= target && hi - lo >= winBy`, or `cap && hi >= cap`.
- A final set score `(a, b)` is *reachable* iff the set is won at `(a, b)` and was not already won at `(hi - 1, lo)`. (25-23 yes; 26-24 yes; 27-24 no; 30-29 yes under a cap of 30.)

### Match
- `bestOf` in {1, 3, 5}. A side needs `ceil(bestOf / 2)` set wins.
- The **deciding set** is set number `bestOf` when `bestOf > 1` (it can only be reached at 1-1 or 2-2). It plays to `min(15, target)`: 15 for 21/25 matches, and 11 stays 11 for casual (decision: a deciding set longer than the others would be odd). Win-by and cap carry over, with the cap computed from the deciding target.
- **Preset id** is `<target>-w<winBy>[c]-bo<bestOf>`, e.g. `25-w2-bo3`, `21-w2c-bo3`, `11-w1-bo1`. 4 targets x (win by 1, win by 2, win by 2 + cap) x 3 lengths = 36 presets. Parsed in TS (`presets.ts`) and SQL (`bk_preset`).

### Rotation, serving and side switches (the state)
State keeps, beyond basketball's score/pending/proposed/dispute/log:

```
roster        {A: id[], B: id[]}      who is in the game (for "who" validation)
startOrder    {A: id[], B: id[]}      serving order at the start of every set (= the order sent to create_game)
rotation      {A: id[], B: id[]}      current serving order; rotation[side][0] is the server, the rest follow in position order
serving       'A' | 'B'               team holding serve
firstServer   'A' | 'B'               who served first in set 1 (A by default; coin flips happen off-app)
ends          {A: 'L'|'R', B: ...}    which end of the court each team is on
setNo         1-based number of the current set
score         {A,B}                   points in the CURRENT set
sets          [{A,B}...]              completed sets
timeouts      {A,B}                   timeouts used this set
points        [{set,side,tag?,who?,server,sideOut}]   confirmed rallies in order (the replay is built from these)
events        [{k, ...}]              typed log: side_out, side_switch, set_end, timeout, substitution
```

Rules, applied identically in `applyEvent` (TS) and `game_apply_event` (SQL):
1. A point is **claimed by one side and confirmed by the other** (Live) exactly as in basketball. Only `claim_point{side, tag?, who?}` can start one.
2. On a confirmed point for side X:
   - `score[X]++`; `points` gets a record naming the server at that moment.
   - If X was **not** serving it is a **side-out**: `serving := X`, X's `rotation` rotates by one (`shift` the head to the tail, so the player who stood at position 2 becomes the server), and a `side_out` event is logged.
   - If X was serving, nothing rotates; the same server serves again.
   - The same rule gives beach 2v2 its "partners alternate serving each time the team regains serve" and 4v4/6v6 the usual rotation. One uniform rule, three formats. (The brief only requires 6v6 to rotate; beach is the 2-player case of the same list.)
3. If the point wins the set: push `score` to `sets`, log `set_end`. If the match is decided, `status = awaiting_final` (both captains confirm, as before). Otherwise the next set starts: `setNo++`, `score = 0-0`, `rotation = startOrder`, `serving` = the side that did **not** serve first in the previous set (first serve alternates every set, deciding set included), `ends` flip (teams change ends between sets in every format), `timeouts = 0-0`.
4. **Beach side switches** (`tier == 2`): after a confirmed point that does not end the set, if `scoreA + scoreB` is a multiple of 7 (5 in the deciding set) the ends flip and a `side_switch` event is logged with the total. Other formats switch only between sets.
5. **Timeouts** (optional): `timeout{side}` by that side's captain, only in `active` with nothing pending, at most 2 per team per set. Logged, no confirmation needed.
6. **Substitution** (optional, `tier == 6` only): `substitution{side, out, in}` swaps `out` (on court) for `in` (a roster player of that side not in `rotation`) in the same position. A game's roster is exactly the format size in this draft (no bench), so the reducer accepts the event shape but the SQL/TS reducers reject it with `no_bench` until a bench exists. See OPEN_QUESTIONS.

### Per-point tag and "who"
- `tag` in `ace | kill | block | error`, optional. `who` optional, a player id.
- **Correct side**: for `ace`, `kill`, `block` (and an untagged `who`) the player must be on the **point-winning** side; for `error` the player is on the **losing** side.
- `ace` is only legal if the point winner was **serving** when the rally started.
- Server-validated against `roster` in SQL and TS. A bad tag or `who` rejects the claim; it is never guessed or auto-filled.

### Quick mode and disputes
- Quick mode: one side proposes the **whole result as a list of set scores**; the other confirms. Every set must be a reachable final under that set's rule (deciding set uses 15), no set may follow a decided match, and the match must be decided.
- Dispute freezes everything (as in basketball, incl. the Quick-mode bug fixed there). Resume needs both captains to submit the **same list of set scores**; all sets but the last must be complete, the last may be in progress. Serving and rotation are not reconstructed after a correction (they cannot be known); the game is flagged `corrected` and its replay says so instead of inventing rallies.
- `games.score_a / score_b` hold **sets won**, so the sport-neutral winner/rating code ("higher score won") keeps working. Point scores live in `state`.

## 3. Ratings

- OpenSkill Plackett-Luce per format 2 / 4 / 6, teams of any size, unchanged math (`rate`). A match is one rating event (the winner of the match), not one per set.
- Mixed-rating teams work as in basketball: each player is updated from their own mu/sigma against the other team.
- Lanes unchanged: Ranked (OpenSkill, check-in required), Casual (no rating, optional separate Casual Elo), Private (friends, Elo history of the last 10 games).
- Provisional: fewer than 10 games or fewer than 5 distinct opponents. Repeat weight (1 - 0.15n per repeat opponent/teammate game, floor 0.25). Cold-start prior across formats and the display-only overall rating: unchanged.
- **Own display scale and name: "Net Rating"** (NR). `mu 25 = 1000`, `1 mu = 20 points`, range is one sigma: a new player shows `1000 +/- 167`. (Basketball: 1200, 24 per mu.) Casual and Private Elo also start at 1000. Constants live in one place in TS and SQL and the existing SQL/TS parity fuzz covers them.
- Rating never takes currency, cosmetics or surface as input (the guard test stays).

## 4. Court data

Import (`scripts/import-courts.ts`, `packages/core/src/courts.ts`) from OpenStreetMap `leisure=pitch` with `sport=volleyball` or `sport=beach_volleyball` (also `sport=volleyball;beach_volleyball`, and `sport=*;volleyball` multi-values).

Court classes `beach | indoor | grass | unknown`, first match wins:
1. `sport=beach_volleyball` or `surface` in sand family (`sand`, `beach`...) -> `beach`
2. `indoor=yes` or `leisure=sports_hall` / `building=*` hint -> `indoor`
3. `surface` in `grass`, `grass_paver`, `turf`, `artificial_turf` -> `grass`
4. otherwise `unknown` (a player can confirm the class at check-in; cannot host 6v6)

Fields kept: `nets` (from `nets`, `courts`, `volleyball:nets` tags, else estimated from geometry when present, else null), surface, access, indoor, name, a **permit note** flag.
- Reference sizes: indoor 9 x 18 m (162 m2), beach 8 x 16 m (128 m2). With geometry the area gives a **nets estimate** only (`round(area / 250)`, min 1 when 60-2500 m2); the class itself is tag-driven because indoor and beach areas overlap once run-off space is included.
- Private access (`private`, `no`, `customers`, `permit`) is imported but hidden, as in basketball. Courts within 35 m with the same access merge into one site (nets sum).
- **Beach and permits**: many LA beach courts are on public beach land. Court detail shows "Check hours and permits before you go. Public beach courts can have posted hours, reservations or permit rules." This is data/copy only; no booking.
- Network note: the dev sandbox blocks the Overpass API. The script supports `--query` (prints the Overpass query) and a `--sample` file; a small clearly-synthetic sample is committed so tests and the demo run. See DECISIONS.

## 5. Avatar and poses

Same vector character, drawn in code; barefoot on sand (shoes slot hidden on the sand stage), knee pads and sleeves as layers.
Poses (joint-angle keyframes, as in `choreo.ts`): `ready`, `bump` (forearm platform pass), `set` (overhead hands), `spike` (jump + arm swing), `block` (two hands over the net), `serve_float` (standing toss + flat strike), `serve_jump` (running toss + jump strike), `dive` (horizontal dig), `celebrate`.
Gear layers: jersey (3 styles + sleeves), shorts, knee pads, indoor shoes, visor, sunglasses, sleeves, ball skins.

## 6. Replay

Pure function of `state.points` (plus `events` for side switches). ~7 s per point won. Side view; net in the middle; two stages: **sand beach** (sun, sea band, sand) and **indoor gym** (floor lines, bleachers). The stage follows the game's court class (beach -> sand, otherwise gym).

Rally script by tag:
| Tag | Script |
|---|---|
| `ace` | server tosses and serves, ball lands in the far court untouched, receivers watch |
| `kill` (default) | serve, bump, set, spike, ball hits the floor on the other side |
| `block` | serve, bump, set, spike, block stuffs the ball back down on the attacker's side |
| `error` | serve or attack goes into the net / long; point goes to the other team |
| untagged | the kill script (the tag is never guessed from the score or the server) |

The side-out and serving team show who serves (from `points[i].server`). Named players are only animated when `who` was recorded and validated; otherwise the team is animated generically. Live view is a small court strip with no crowd. Quick/voided/empty/corrected games explain why there is no replay.

## 7. Cosmetics and the shop

Slots: `jersey`, `shorts`, `kneepads`, `shoes` (indoor), `eyewear` (visor/sunglasses), `accessory` (sleeves, wristbands), `ball` (skin), `celebration`, and animation styles `serve`, `spike`, `set`, `block`, `dive`.
- Required slots (never empty): jersey, shorts, shoes, ball, celebration, plus the animation styles (each has a free starter).
- Optional slots: kneepads, eyewear, accessory.
- Prices by rarity (Royalty Bucks): common 100 / rare 300 / epic 800 / legendary 2000. King Credits (bought) are a stub; premium-only items cannot be bought.
- Catalog source is `packages/core/src/cosmetics.ts`; the SQL seed is generated and a drift test guards it.
- Currency names shown to players: **Royalty Bucks** (earned) and **King Credits** (bought, not live). Internal names keep `gold`.

## 8. Themes

Three styles, contrast-checked at WCAG AA in all of them: **Night Court** (indoor night, the approved original), **Sand** (daylight sun-and-sand beach look; replaces basketball's Street Light) and **Royal Arena** (purple night, crown gold). Layout and rules identical; only colour, corners and border weight change.

## 9. Test plan for the sport-specific parts
- Vitest (core): set/match win, reachable-final property, cap, deciding-set target, rotation invariants (order is always a permutation of start order; only the receiving side rotates; server is always `rotation[serving][0]`), beach switch points, tag/who validation, Quick/dispute set lists, replay builder, court classifier.
- Parity fuzz (`scripts/test-parity.ts`): random sequences for formats 2/4/6 and random presets; TS and SQL must agree on accept/reject and on the full visible state after every event.
- pgTAP: preset parser, function privileges, ratings for 2/4/6, cosmetics seed.
- Rating parity fuzz: SQL vs TS display scale and Plackett-Luce for 2/4/6.
