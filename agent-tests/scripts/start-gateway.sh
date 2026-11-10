#!/usr/bin/env bash
# Start the test gateway (next dev) from this checkout on port 3100. Foreground; Ctrl-C to stop.
set -euo pipefail
. "$(dirname "$0")/env.sh"
cd "$_AT_ROOT"
exec pnpm exec next dev -p "$AGENT_TESTS_PORT"
