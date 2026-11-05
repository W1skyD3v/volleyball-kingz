#!/usr/bin/env bash
# Load and latency check: real court data (about 1,650 sites) plus 200 players, hammering the main endpoints through PostgREST.
# Needs the same environment as scripts/pentest.sh. Prints p50/p95/p99 and the error rate per scenario.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=vk_load
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" -c "alter database $DB set search_path = \"\$user\", public, extensions"
psql -q -v ON_ERROR_STOP=1 -d $DB -f scripts/stub_auth.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"; done
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/seed/courts.sql
PGDATABASE=$DB pnpm exec tsx scripts/loadtest.ts
