#!/usr/bin/env bash
# Run a command with the agent-tests environment, from a subdirectory of agent-tests.
#   agent-tests/scripts/with-env.sh ts pnpm exec tsx harness/cli.ts begin approve
#   agent-tests/scripts/with-env.sh py uv run python -m harness.run --scenario approve
set -euo pipefail
. "$(dirname "$0")/env.sh"
cd "$AGENT_TESTS_ROOT/$1"; shift
exec "$@"
