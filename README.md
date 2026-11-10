# Mandate

**The trust layer for agent payments on PayPal.** PayPal made agents able to pay. This makes it safe to let them.

Live demo: https://mandate-gateway.vercel.app (PayPal sandbox)

A gateway sits between any AI shopping agent and the user's PayPal account. The agent never holds payment credentials. It asks the gateway to pay, and the gateway decides.

- **Authorise.** The user writes a mandate in plain English: "up to $150 on running shoes, known merchants only, ask me above $100". A model compiles it to rules, the user confirms them, and from then on plain code enforces them.
- **Buy.** Agents connect over MCP. Each purchase is checked against the mandate, then paid from the user's vaulted PayPal wallet, sent to the user for one-tap approval, or blocked with a reason.
- **Protect.** Every step is written to a hash-chained, Ed25519-signed ledger. When something goes wrong after the purchase, that record settles it: the merchant refunds on it, or answers a PayPal dispute with it.

## What it does, end to end

All of this runs against the PayPal sandbox with real sandbox money.

| Path | What happens |
|---|---|
| Approved | An agent asks for an $89 running shoe at a verified store. The gateway reads the product page itself, the policy passes, and the user's saved PayPal wallet pays the store directly with nobody present. |
| Needs approval | A $135 shoe is over the user's $100 ask-above threshold. It waits for one tap in the dashboard, then pays. |
| Blocked | An unverified store, a price that differs from the merchant's page, an over-budget purchase and an unregistered site are each blocked with a named reason. |
| Prompt injection | A product page hides an instruction telling agents to buy a $100 gift card instead. An agent that obeys it is still blocked: gift cards are a blocked category and the limits are not enforced by a model. |
| Wrong item | The store ships the wrong item. The user reports it once; the gateway sends the store the signed record, the store checks it against its own fulfilment record and refunds through PayPal. |
| Dispute | The buyer opens a PayPal dispute claiming non-receipt. The store's agent answers it through the Disputes API with the signed record as a PDF and a tracking number. PayPal resolves it in the seller's favour. |

## How a purchase is decided

The agent supplies a product URL and what the user asked for. Everything else the gateway establishes itself:

| Fact | Source |
|---|---|
| Who gets paid | The gateway's merchant registry, never the agent |
| Product and price | The gateway fetches the merchant's page and reads its schema.org data |
| Limits, merchants, thresholds, expiry | Plain code in [`src/lib/policy.ts`](src/lib/policy.ts) |
| "Is this product running shoes?" | A model, whose answer can only narrow what is allowed |

A prompt injection can change what an agent asks for. It cannot raise a limit, change a payee, or make a gift card count as shoes.

## Architecture

```
 Shopping agent (Claude, ChatGPT, custom)
        |  MCP: get_mandate, request_purchase, check_status, report_problem
        v
 +------------------- Gateway -------------------+        +----- Merchant -----+
 |  Policy engine  -> approve / ask user / block |        |  Storefront        |
 |  PayPal executor -> Vault v3 + Orders v2      | -----> |  MCP catalogue     |
 |  Evidence ledger (hash chain, Ed25519)        | signed |  Returns agent     |
 |  Resolution    -> refund request to merchant  | record |  Dispute agent     |
 +-----------------------------------------------+        +--------------------+
        ^                          ^                              |
   Web dashboard             PayPal webhooks  <----  Refunds v2, Disputes v1
```

## PayPal APIs used

- **Vault v3** (`/v3/vault/setup-tokens`, `/v3/vault/payment-tokens`): the user saves their PayPal wallet once.
- **Orders v2** (`/v2/checkout/orders` with `payment_source.paypal.vault_id`): each approved purchase is created and captured against the vault token, with the merchant as payee.
- **Payments v2** (`/v2/payments/captures/{id}/refund`): the merchant refunds from its own account.
- **Customer Disputes v1** (list, show, `provide-evidence`, `accept-claim`, `send-message`, and the sandbox-only `adjudicate`): the merchant's agent answers disputes.
- **Webhooks** (`PAYMENT.CAPTURE.*`, `CUSTOMER.DISPUTE.*`) with signature verification through `/v1/notifications/verify-webhook-signature`.

## The evidence ledger

Each entry stores its type, payload and timestamp, the previous entry's hash, its own SHA-256 hash, and an Ed25519 signature over that hash. Editing, removing or reordering any row breaks verification, and the dashboard has a button that re-checks the whole chain.

For one purchase the record holds the mandate text and rules hash, the user's request, the agent's stated reason, the product page as the gateway fetched it (with a hash of the page), every policy check, the user's approval if one was needed, the PayPal order and capture IDs, and anything that happened afterwards. A merchant verifies it against the public key at `/.well-known/mandate-gateway.json`.

## Try it

**In the hosted demo**

1. Open https://mandate-gateway.vercel.app and click **Link PayPal**. Log in with a US PayPal sandbox personal account.
2. Write a mandate, click **Turn into rules**, check them and **Confirm mandate**.
3. Click **Connect agent** and add the generated config to an MCP client such as Claude Desktop. It adds the gateway and the two demo stores' catalogues.
4. Ask the agent to buy running shoes, and watch the activity feed.

The demo stores are at `/stores/stride` (verified) and `/stores/kickz` (not verified). Each has a back office at `/stores/<name>/admin` where you can ship an order correctly or ship the wrong item.

**Locally**

Needs Node 22, pnpm and a local PostgreSQL install (for `initdb` and `pg_ctl`).

```bash
pnpm install
cp .env.example .env.local   # fill it in; `pnpm keygen` prints a ledger signing key
pnpm db:up && pnpm db:push
pnpm dev
```

Without PayPal credentials the gateway runs with clearly labelled simulated payments. With them, you need two US sandbox business accounts (one for the gateway app with **Save payment methods** enabled, one for the Stride store) and a US sandbox personal account as the buyer.

## Tests

```bash
pnpm test                                             # 15 policy engine tests
pnpm exec tsx --env-file=.env.local scripts/e2e.ts    # 17 end-to-end checks over MCP against a running server
```

The end-to-end script drives the gateway as an agent would and covers the approved, blocked, injected and refunded paths plus ledger tamper detection. It passes against the hosted deployment with real sandbox payments. `scripts/gullible-agent.ts` is a deliberately naive agent that obeys instructions found in product text, for demonstrating the injection block.

## Layout

- [`src/lib/policy.ts`](src/lib/policy.ts): the policy engine (pure, deterministic)
- [`src/lib/gateway.ts`](src/lib/gateway.ts): purchase, approval, payment and problem flows
- [`src/lib/ledger.ts`](src/lib/ledger.ts): the evidence ledger
- [`src/lib/paypal.ts`](src/lib/paypal.ts): Vault, Orders, refunds, Disputes, webhook verification
- [`src/lib/llm.ts`](src/lib/llm.ts): mandate compiler, product classifier, problem analysis (Claude)
- [`src/app/api/mcp`](src/app/api/mcp/route.ts): the gateway's MCP server
- [`src/lib/stores/merchant.ts`](src/lib/stores/merchant.ts): the merchant side: order intake, returns agent, dispute agent
- [`src/app/stores`](src/app/stores): the two demo merchants

Stack: Next.js 15, TypeScript, PostgreSQL with Drizzle, the Model Context Protocol, Claude, deployed on Vercel with Neon.

## Limits of this build

- **Sandbox only.** It has never run against live PayPal. Paying a third-party merchant from a vaulted wallet works in the sandbox as built; in production we expect it to need PayPal's partner onboarding for each merchant.
- **The demo merchants live in the same app as the gateway.** They talk to it over HTTP and verify its signatures, but they share its database and deployment.
- **A PayPal buyer cannot open a dispute through the API.** The buyer opens it in PayPal's Resolution Center; everything after that is automated on the merchant's side.
- **The sandbox has no human reviewer**, so the final ruling in the dispute demo is triggered with PayPal's sandbox-only `adjudicate` call.
- **Dashboard sessions are anonymous cookies**, not accounts.
- **A merchant fetches the evidence record by presenting the PayPal capture ID**, which is weaker than real merchant authentication.

MIT licensed.
