# Privacy policy (DRAFT, not reviewed by counsel)

Operator: [COMPANY NAME], [ADDRESS]. Contact: [PRIVACY EMAIL]. Last updated: [DATE].

## What we collect (matches the current database schema)
| Data | Why | Notes |
|---|---|---|
| Email address (login) | Sign-in by one-time code | Held by the auth provider (Supabase Auth). |
| Display name | Shown to other players | You choose it. Avoid your real full name. |
| Birth year and an "under 18" flag | Age rules | The full birth date is **not** stored. Under 13: no account. |
| Avatar settings | Show your avatar | Colours, style, seed. |
| Court check-ins | Show who is at a court, verify ranked games | We store the court, the time, and the **distance** to the court. We do **not** store your raw coordinates. A check-in expires after 90 minutes or when you tap "I'm leaving". |
| Location (foreground only) | Check-in, sort courts by distance | Read only while the app is open and only when you tap. Never in the background. Not sent to the server except at check-in and for "courts near me". |
| Games, scores, ratings, feedback | Play and rating | |
| Reports and blocks you file | Safety | Visible to our moderators. The reported person is not told who reported. |
| Gold earned | In-app reward | Not purchasable in this version. |
| Friend code, friend requests | Add friends by code | Friends can see which court you are checked in at. Nobody else can. |
| Public leaderboard entry | Ranked scoreboards | Adults only, after 10 rated games: your display name, rating and game count are public, including to people without an account. [COUNSEL: consent wording at sign-up.] |

## Minors (13 to 17)
- Minors are never shown to adult users: not on the run board, not in court headcounts, not in profiles.
- Minors and adults cannot be placed in the same game.
- [COUNSEL: parental consent model, COPPA/state rules, school affiliation approach, messaging rules.]

## What we do not do
No ads, no sale of personal data, no background location, no school ID collection, no data from your contacts. [CONFIRM before release.]

## Your choices
Delete your account in the app (Me > Delete my account) or at [WEB DELETION URL]. By default we **keep your display name and your ranked game history and rating** (so past games and leaderboards stay correct) and delete everything else: your login, email link, avatar, birth year, friends, check-ins, runs, Gold, blocks and your private and casual stats. If you turn off "Keep my name and ranked stats", your name is replaced by "Deleted player" and your ranked games stay under that name. Reports you filed are kept without your identity for safety. [COUNSEL: erasure rights vs. keeping a public name; retention periods.]

## Private games
Results and Elo history of Private games are visible only to you. Other players in the game see the game itself.

## Sharing
Supabase (database, login, hosting), [CRASH REPORTING VENDOR if added]. Court data is from OpenStreetMap contributors (ODbL).
