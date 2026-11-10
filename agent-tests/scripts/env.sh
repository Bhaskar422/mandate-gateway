# Source this file: sets up the environment every agent-tests command needs.
#   . agent-tests/scripts/env.sh
# - Node 22 on PATH (the default node on this machine is too old).
# - ANTHROPIC_BASE_URL unset (the shell points it at a proxy that must not be used).
# - Secrets from <repo root>/.env.local (never printed).
# - The test gateway on port 3100, backed by its own database (see setup-db.sh for why).
_AT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
[ -d "$HOME/.nvm/versions/node/v22.23.4/bin" ] && export PATH="$HOME/.nvm/versions/node/v22.23.4/bin:$PATH"
unset ANTHROPIC_BASE_URL
if [ -f "$_AT_ROOT/.env.local" ]; then set -a; . "$_AT_ROOT/.env.local"; set +a; fi
export AGENT_TESTS_PORT="${AGENT_TESTS_PORT:-3100}"
export GATEWAY_URL="${GATEWAY_URL:-http://localhost:$AGENT_TESTS_PORT}"
export APP_URL="$GATEWAY_URL"
export DATABASE_URL="${AGENT_TESTS_DATABASE_URL:-postgres://postgres@localhost:54329/mandate_agent_tests}"
export AGENT_TESTS_ROOT="$_AT_ROOT/agent-tests"
