#!/usr/bin/env bash
# Project-local Postgres: data lives in .pgdata, listens on 54329. Usage: scripts/db.sh up|down|reset
set -euo pipefail
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
cd "$(dirname "$0")/.."
PGBIN="${PGBIN:-$(dirname "$(command -v initdb)")}"
DATA=.pgdata; PORT=54329; DB=mandate
case "${1:-up}" in
  up)
    [ -d "$DATA" ] || "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust >/dev/null
    "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1 || "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=localhost" -l "$DATA/server.log" -w start >/dev/null
    "$PGBIN/psql" -h localhost -p $PORT -U postgres -tc "select 1 from pg_database where datname='$DB'" | grep -q 1 || "$PGBIN/createdb" -h localhost -p $PORT -U postgres $DB
    echo "postgres://postgres@localhost:$PORT/$DB" ;;
  down) "$PGBIN/pg_ctl" -D "$DATA" -m fast stop ;;
  reset) "$PGBIN/pg_ctl" -D "$DATA" -m fast stop 2>/dev/null || true; rm -rf "$DATA"; "$0" up ;;
esac
