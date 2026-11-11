#!/usr/bin/env bash
# Baseline: the same agents and catalogue WITHOUT the gateway, paying with the PayPal Agent Toolkit (sandbox).
#
#   agent-tests/run-baseline.sh                         # 2 conditions x 3 models x 5 scenarios x 3 runs, then the report
#   agent-tests/run-baseline.sh --only-missing          # only cells that are absent or ended in an error
#   agent-tests/run-baseline.sh --model gemini-flash-latest --concurrency 1 --runs 3
#
# Options go to ts/baseline/run.ts: --model, --condition plain,hardened, --scenario, --runs, --concurrency, --only-missing.
# The test gateway is started only to serve the store catalogues; the baseline agents never talk to the gateway itself.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/scripts/env.sh"
"$HERE/scripts/setup-db.sh" || exit 1
(cd "$HERE/ts" && pnpm install --ignore-workspace --silent) || exit 1

STARTED_GATEWAY=""
if ! curl -sf -o /dev/null "$GATEWAY_URL/"; then
  mkdir -p "$HERE/results/logs"
  (cd "$_AT_ROOT" && pnpm install --silent && exec pnpm exec next dev -p "$AGENT_TESTS_PORT") > "$HERE/results/logs/gateway.log" 2>&1 &
  STARTED_GATEWAY=$!
  trap '[ -n "$STARTED_GATEWAY" ] && pkill -P "$STARTED_GATEWAY" 2>/dev/null; kill "$STARTED_GATEWAY" 2>/dev/null' EXIT
  for _ in $(seq 1 60); do curl -sf -o /dev/null "$GATEWAY_URL/" && break; sleep 1; done
  curl -sf -o /dev/null "$GATEWAY_URL/" || { echo "the test gateway did not start; see results/logs/gateway.log"; exit 1; }
fi

(cd "$HERE/ts" && pnpm exec tsx baseline/run.ts "$@") || exit 1
(cd "$HERE/ts" && pnpm exec tsx harness/report.ts)
