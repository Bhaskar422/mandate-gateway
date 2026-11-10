#!/usr/bin/env bash
# Create the agent-tests database as a schema-only copy of the app database.
#
# Why a separate database: the gateway re-registers the demo stores with
# `base_url = APP_URL + /stores/<slug>` (ensureSeed in src/lib/gateway.ts, an upsert on the
# merchants table). A second gateway on port 3100 pointed at the shared `mandate` database would
# rewrite those two rows and make the main checkout's gateway (port 3000) reject its own product
# URLs as "not a known merchant". A sibling database keeps the test gateway from touching any
# shared row. Nothing is migrated: the schema is copied with pg_dump, the shared database is only read.
set -euo pipefail
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
HOSTARGS=(-h "${PGHOST:-localhost}" -p "${PGPORT:-54329}" -U "${PGUSER:-postgres}")
SRC="${AGENT_TESTS_SOURCE_DB:-mandate}"; DST="${AGENT_TESTS_DB:-mandate_agent_tests}"
if "$PG_BIN/psql" "${HOSTARGS[@]}" -Atc "select 1 from pg_database where datname='$DST'" postgres | grep -q 1; then
  if [ "${1:-}" != "--recreate" ]; then echo "$DST already exists (pass --recreate to rebuild it from $SRC's current schema)"; exit 0; fi
  "$PG_BIN/dropdb" "${HOSTARGS[@]}" "$DST"
fi
"$PG_BIN/createdb" "${HOSTARGS[@]}" "$DST"
"$PG_BIN/pg_dump" "${HOSTARGS[@]}" --schema-only --no-owner "$SRC" | "$PG_BIN/psql" "${HOSTARGS[@]}" -q -v ON_ERROR_STOP=1 "$DST" >/dev/null
echo "created $DST from the schema of $SRC"
