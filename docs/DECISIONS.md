# Decisions log

Newest at the bottom. The Commander is away: reasonable calls are made here instead of asking. Real questions go to `OPEN_QUESTIONS.md`.
Sport rules and design live in `SPORT_DESIGN.md`. Engine fixes that also apply to Basketball Kingz live in `UPSTREAM.md`.

## 2026-11-05 Setup
- **Source**: engine copied from `W1skyD3v/basketball-kingz` branch `draft/phase1` (commit e90dda2), read-only. Nothing was pushed to or opened against it.
- **pickleball-kingz** exists but is an empty repository (no commits, no docs), so there was nothing to reuse from `SPORT_DESIGN.md` / `UPSTREAM.md` there.
- **Branches**: work is on `draft/phase1` as the brief says. The session harness also names `claude/peaceful-franklin-vgr1ye` as the designated branch, so each push goes to both (same commits, so neither instruction is broken).
- **Not copied**: `packages/team` (persona/tribunal tooling), `.claude/agents`, `docs/team`, `docs/tribunal`, `docs/evidence`, `docs/handoffs`, the basketball OSM data file. They are not in the keep list and are basketball-team process, not product.
- **Renames**: workspace scope `@bk/*` -> `@vk/*`, SQL helper prefix `bk_` -> `vk_`, database `bk_test` -> `vk_test`, product name in strings.
- **Baseline before changing any sport logic** (renamed copy): typecheck, eslint clean; core 76, avatar 18, guards 36, mobile 68 unit tests; pgTAP 10 files (all ok), rating pipeline, SQL/TS rating parity, reducer parity (600 sequences) all passed. Postgres 16 + PostGIS 3.4 + pgTAP 1.3 were installed with apt in the sandbox.
- **Keep `tier` as the internal name for players per side** (values 2, 4, 6) so the sport-neutral engine, tables and RPCs keep their shape. UI copy says "format".
