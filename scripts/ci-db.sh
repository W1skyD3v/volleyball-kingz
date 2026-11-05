#!/usr/bin/env bash
# Self-contained database CI: fresh Postgres 16 cluster + PostGIS + pgTAP + PostgREST, then the pgTAP suites, the rating
# worker, the TS/SQL parity fuzz and the adapter e2e suite. Used by .github/workflows/ci.yml and runnable locally.
#   CI=true scripts/ci-db.sh     installs apt packages and downloads PostgREST first (Ubuntu 24.04)
#   scripts/ci-db.sh             assumes packages are present
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=/usr/lib/postgresql/16/bin
PORT=${CI_PGPORT:-54330}
POSTGREST_VERSION=${POSTGREST_VERSION:-v12.2.3}
WORK=$(mktemp -d)

if [ "${CI:-}" = "true" ]; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq postgresql-16 postgresql-16-postgis-3 postgresql-16-pgtap >/dev/null
  curl -sSL -o "$WORK/pgrst.tar.xz" "https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/postgrest-${POSTGREST_VERSION}-linux-static-x64.tar.xz"
  tar -xf "$WORK/pgrst.tar.xz" -C "$WORK"
  export POSTGREST_BIN="$WORK/postgrest"
fi
: "${POSTGREST_BIN:?set POSTGREST_BIN to a PostgREST binary}"

# initdb refuses to run as root; become the postgres user when we are root (containers), otherwise use the current user.
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
DATA="$WORK/data"; SOCK="$WORK/sock"; mkdir -p "$SOCK"
if [ "$(id -u)" = 0 ]; then chown -R postgres "$WORK"; chmod 755 "$WORK"; fi
as_pg "$PGBIN/initdb -D $DATA -A trust >/dev/null"
as_pg "$PGBIN/pg_ctl -D $DATA -o '-p $PORT -k $SOCK' -l $WORK/pg.log -w start >/dev/null"
trap 'as_pg "$PGBIN/pg_ctl -D $DATA -m fast stop >/dev/null" || true' EXIT

export PGHOST=$SOCK PGPORT=$PORT PGUSER=${PGUSER_OVERRIDE:-$(if [ "$(id -u)" = 0 ]; then echo postgres; else id -un; fi)}
scripts/test-db.sh
scripts/test-e2e.sh
scripts/pentest.sh
