#!/usr/bin/env bash
# Run migrations + pgTAP against any Postgres with PostGIS and pgTAP installed (no Docker, no Supabase CLI).
# Usage: PGHOST=/tmp PGPORT=54329 PGUSER=postgres scripts/test-db.sh
# Supabase's auth schema is stubbed (scripts/stub_auth.sql). With Docker prefer: supabase start && supabase test db
set -euo pipefail
cd "$(dirname "$0")/.."
DB=vk_test
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" -c "alter database $DB set search_path = \"\$user\", public, extensions"
psql -q -v ON_ERROR_STOP=1 -d $DB -c "create extension if not exists pgtap" -f scripts/stub_auth.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"; done
fail=0
for f in supabase/tests/*.sql; do
  out=$(psql -qAt -d $DB -f "$f" 2>&1)
  # Any pgTAP failure OR any psql error fails the run (errors used to hide behind a "N ok" count).
  echo "$out" | grep -E '^(not ok|# |psql:.*ERROR)' && fail=1
  echo "$f: $(echo "$out" | grep -c '^ok') ok"
done
export PGDATABASE=$DB
pnpm exec tsx scripts/test-ratings.ts || fail=1
pnpm exec tsx scripts/test-math-parity.ts || fail=1
pnpm exec tsx scripts/test-parity.ts || fail=1
exit $fail
