#!/usr/bin/env bash
# Run the whole suite: test database, test gateway, TypeScript matrix, Python matrix, report.
#
#   agent-tests/run-all.sh                 # full matrix on the default models (claude-haiku-5-5)
#   agent-tests/run-all.sh --opus          # also a one-architecture pass on claude-opus-5-5
#   agent-tests/run-all.sh --scenario approve --framework anthropic-sdk,crewai   # filters go to both runners
#
# Filters: --framework, --architecture, --scenario, --model, --concurrency (same for both languages;
# a framework name only one language knows is ignored by the other).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/scripts/env.sh"

OPUS=0; ARGS=(); FRAMEWORKS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --opus) OPUS=1; shift ;;
    --framework) FRAMEWORKS="$2"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

TS_ALL="anthropic-sdk claude-agent-sdk vercel-ai-sdk langgraph-js"
PY_ALL="langgraph-py crewai pydantic-ai openai-agents google-adk"
pick() { # pick <known names> -> the comma list of requested names this language knows ("" = none requested here)
  local out=""; for f in $1; do case ",$FRAMEWORKS," in *",$f,"*) out="${out:+$out,}$f" ;; esac; done; echo "$out"
}
if [ -n "$FRAMEWORKS" ]; then TS_FW="$(pick "$TS_ALL")"; PY_FW="$(pick "$PY_ALL")"; else TS_FW="all"; PY_FW="all"; fi
"$HERE/scripts/setup-db.sh" || exit 1
(cd "$HERE/ts" && pnpm install --ignore-workspace --silent) || exit 1
(cd "$HERE/py" && uv sync --quiet) || exit 1

STARTED_GATEWAY=""
if ! curl -sf -o /dev/null "$GATEWAY_URL/"; then
  mkdir -p "$HERE/results/logs"
  (cd "$_AT_ROOT" && pnpm install --silent && exec pnpm exec next dev -p "$AGENT_TESTS_PORT") > "$HERE/results/logs/gateway.log" 2>&1 &
  STARTED_GATEWAY=$!
  trap '[ -n "$STARTED_GATEWAY" ] && pkill -P "$STARTED_GATEWAY" 2>/dev/null; kill "$STARTED_GATEWAY" 2>/dev/null' EXIT
  for _ in $(seq 1 60); do curl -sf -o /dev/null "$GATEWAY_URL/" && break; sleep 1; done
  curl -sf -o /dev/null "$GATEWAY_URL/" || { echo "the test gateway did not start; see results/logs/gateway.log"; exit 1; }
fi

run_ts() {
  if [ "$TS_FW" = all ]; then (cd "$HERE/ts" && pnpm exec tsx harness/run.ts "$@")
  elif [ -n "$TS_FW" ]; then (cd "$HERE/ts" && pnpm exec tsx harness/run.ts --framework "$TS_FW" "$@"); fi
}
run_py() {
  if [ "$PY_FW" = all ]; then (cd "$HERE/py" && uv run python -m harness.run "$@")
  elif [ -n "$PY_FW" ]; then (cd "$HERE/py" && uv run python -m harness.run --framework "$PY_FW" "$@"); fi
}

echo "== TypeScript matrix =="; run_ts ${ARGS[@]+"${ARGS[@]}"}
echo "== Python matrix ==";     run_py ${ARGS[@]+"${ARGS[@]}"}
if [ "$OPUS" = 1 ]; then
  echo "== claude-opus-5-5 pass (single architecture) =="
  run_ts ${ARGS[@]+"${ARGS[@]}"} --architecture single --model claude-opus-5-5
  run_py ${ARGS[@]+"${ARGS[@]}"} --architecture single --model claude-opus-5-5
fi
(cd "$HERE/ts" && pnpm exec tsx harness/report.ts)
