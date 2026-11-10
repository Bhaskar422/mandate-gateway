# Mandate

The trust layer for agent payments on PayPal. PayPal made agents able to pay; this makes it safe to let them.

A gateway sits between any AI shopping agent and the user's PayPal account. The agent never holds payment credentials. It asks the gateway to pay, and the gateway decides.

- **Authorise.** The user writes a mandate in plain English. A model compiles it to rules, the user confirms them, and from then on plain code enforces them.
- **Buy.** Agents connect over MCP. Each purchase is checked against the mandate, then paid from the user's vaulted PayPal wallet, sent to the user for one-tap approval, or blocked with a reason.
- **Protect.** Every step is written to a hash-chained, Ed25519-signed ledger. If something goes wrong, the gateway sends the merchant that record and pursues the refund.

## How a purchase is decided

The agent supplies a product URL and what the user asked for. Everything else the gateway establishes itself:

| Fact | Source |
|---|---|
| Who gets paid | The gateway's merchant registry, never the agent |
| Product and price | The gateway fetches the merchant's page and reads its schema.org data |
| Limits, merchants, thresholds, expiry | Plain code in `src/lib/policy.ts` |
| "Is this product running shoes?" | A model, whose answer can only narrow what is allowed |

A prompt injection can change what an agent asks for. It cannot raise a limit, change a payee, or make a gift card count as shoes.

## Run it

Needs Node 22, pnpm and a local PostgreSQL install (for `initdb`/`pg_ctl`).

```bash
pnpm install
cp .env.example .env.local   # then fill it in; `pnpm keygen` prints a ledger signing key
pnpm db:up && pnpm db:push
pnpm dev
```

Without PayPal credentials the gateway runs with clearly labelled simulated payments. `pnpm test` runs the policy tests; `pnpm exec tsx --env-file=.env.local scripts/e2e.ts` drives every path over MCP against the running server.

## Layout

- `src/lib/policy.ts`: the policy engine (pure, deterministic)
- `src/lib/gateway.ts`: purchase, approval, payment and problem flows
- `src/lib/ledger.ts`: the evidence ledger
- `src/lib/paypal.ts`: Vault v3, Orders v2, refunds, Disputes, webhook verification
- `src/lib/llm.ts`: mandate compiler, product classifier, problem analysis
- `src/app/api/mcp`: the gateway's MCP server (`get_mandate`, `request_purchase`, `check_status`, `report_problem`)
- `src/app/stores`: two demo merchants, each with a storefront, an agent-facing MCP catalogue, a returns agent and a back office

MIT licensed.
