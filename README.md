# Mandate

**Proof for every agent purchase on PayPal.** Agents buy inside rules the buyer set. Every step is signed, so the buyer gets a refund on the record and the store wins a dispute with it.

Live demo: https://mandate-gateway.vercel.app (PayPal sandbox)

A gateway sits between any AI shopping agent and the user's PayPal account. The agent never holds payment credentials. It asks the gateway to pay, and the gateway decides. Stopping a bad purchase is half of it. The other half starts after the money moves, and it serves both sides:

- **The buyer** sets the rules, sees why each purchase was paid, held or blocked, and gets refunds settled on a record they can verify.
- **The store** joins by itself, receives a signed record of every order, and answers refund requests and PayPal disputes with that record.

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
| Checked before disputed | Before anything is sent, the buyer picks what went wrong and the gateway lines up its signed record against the store's own order book (`<orders_url>/statement`), fact by fact, and says whose account the two records support. The comparison is pure code, moves no money and is itself written to the ledger. |
| Settlement | For a claim the store's records can't confirm, the buyer's agent and the store's agent negotiate: a replacement, or a partial refund with one counter-offer. It closes automatically when the result is inside the user's settlement rules; otherwise the offer waits for the user. |
| Dispute | The buyer opens a PayPal dispute claiming non-receipt. The store's agent answers it through the Disputes API with the signed record as a PDF and a tracking number. PayPal resolves it in the seller's favour. |
| New merchant | A store the gateway has never seen registers by URL, publishes a token to prove it controls that URL, and only then can be paid. |

## How a purchase is decided

The agent supplies a product URL and what the user asked for. Everything else the gateway establishes itself:

| Fact | Source |
|---|---|
| Who gets paid | The gateway's merchant registry, never the agent |
| Product and price | The gateway fetches the merchant's page and reads its schema.org data |
| Limits, merchants, thresholds, expiry | Plain code in [`src/lib/policy.ts`](src/lib/policy.ts) |
| "Is this product running shoes?" | A model, whose answer can only narrow what is allowed |

A prompt injection can change what an agent asks for. It cannot raise a limit, change a payee, or make a gift card count as shoes.

## Controls

- **Mandates.** Several can be active at once, each optionally scoped to chosen agents. Rules cover a total budget, per-purchase, daily and per-merchant caps, allowed categories, a merchant policy (verified only, a named list, or any registered merchant), a never-buy list, an ask-above threshold, a purchase count and an expiry. A purchase goes ahead under the first mandate that allows it.
- **Page integrity.** The gateway scans the product page it fetched for text addressed to AI agents and for text hidden from shoppers. This is pattern matching, not a model. A flagged page never goes straight to payment: the purchase waits for the user, with the offending text shown.
- **Kill switch.** One click freezes all agent spending, including approvals already waiting.
- **Agent controls.** Pause, resume, revoke or rotate the key of any agent. An agent is paused automatically after five blocked attempts in ten minutes, and each agent is rate-limited.
- **Safe retries.** `request_purchase` takes an idempotency key, and an identical request made again while the first is in flight or just paid returns the same purchase instead of charging twice.
- **Approval links.** A purchase that needs approval carries a secret link the agent can hand to the user, who approves or declines from their phone without opening the dashboard.
- **Notifications.** The user can give one webhook (Slack, Discord, ntfy or their own) that hears about approvals needed, blocked purchases, paused agents and merchant offers.
- **Checked mandates.** The rules a model drafts from the user's words are checked against those words in code before the user sees them: a store rule or a gift-card category the user never wrote is removed, limits above the budget are lowered, and a missing budget, mixed currencies or a missing product category become questions the user must answer. The check runs again at confirmation. "Never buy from X" in any one mandate holds for all of them.
- **Charge on shipment.** A user can choose to be charged only when the store ships. PayPal reserves the money at purchase (an authorization), the gateway captures it when the store reports the shipment, and until then the buyer can cancel and the store releases the reservation. A reservation the store has not shipped after three days is released automatically, by a daily job and whenever the buyer's dashboard loads.
- **Checked against PayPal.** Any purchase can be compared, fact by fact, with PayPal's own record of the order: amount, payee, capture or reservation state, refunds.
- **Guided mandates.** A mandate can be built from a few choices (budget, what, which stores, when to ask) instead of written. Before confirming, the user sees made-up purchases run through the real policy engine: what would be paid, what would ask first, what would be blocked.
- **Demo wallet.** The operator can lend one sandbox buyer to visitors who have no PayPal sandbox account. It is shared, so mandates that spend from it are capped at $200 and all demo spending is capped per day.
- **Built-in shopping assistant.** A chat in the dashboard that shops at the demo stores, for trying the gateway with no setup. It is an ordinary agent: it has its own entry on the Agents page, can be paused or revoked, and buys only through the same functions the MCP server and REST API call. It runs on the gateway's model key, so each user gets a daily message allowance.
- **Sign-in by PayPal.** There is no separate password. The PayPal account a user links is their identity: linking the same account from another browser signs that browser in to the same dashboard.
- **Settlement rules.** The user decides what their agent may accept without asking: partial refunds at or above a chosen share of the price, and replacements.

## For agents

Agents use either door with the same key (`Authorization: Bearer mk_...`):

| MCP tool (`/api/mcp`) | REST (`/api/v1`) | What it does |
|---|---|---|
| `get_mandate` | `GET /mandate` | What the agent may buy, and what is left |
| `check_purchase` | `POST /purchases/check` | Dry run: paid, needs approval or blocked, and why. Nothing is recorded |
| `request_purchase` | `POST /purchases` | Buy one product |
| `check_status` | `GET /purchases/{id}` | Where a purchase stands |
| `report_problem` | `POST /purchases/{id}/problems` | Start a refund or settlement |
| `get_credential` | `GET /mandate/credential` | A short-lived signed statement of what the mandate allows, for the agent to show a store. Pass `store_url` to bind it to one store |

The REST API is described at `/api/v1/openapi.json`. Two endpoints are public: `POST /api/v1/credentials/verify` checks a credential with the gateway, and `GET /api/ledger/head` returns the signed head of the evidence ledger, so anyone can record it and later prove the ledger was not rewritten.

### The mandate credential

A credential lets a store see what an agent may buy without calling the gateway. It works in three steps:

1. The agent gets it from the gateway: `get_credential`, or `GET /api/v1/mandate/credential?store_url=<the store's base address>`.
2. The agent shows it to the store: the store's `present_mandate` MCP tool, or a plain `POST` to the store's mandate endpoint.
3. The store checks it offline with the gateway's public key and answers from its own catalogue.

A credential authorises nothing by itself. Payment still goes through `request_purchase`, where the policy engine decides. It holds no payment details, no buyer name or email, and none of the mandate's own wording.

The credential is `{ payload, signature, algorithm }`. The fields of `payload`:

| Field | Meaning |
|---|---|
| `type`, `version` | Always `"mandate.authorisation"` and `1` |
| `id` | Unique to this credential, `cred_...` |
| `issuer` | The gateway's address. Its public key is at `<issuer>/.well-known/mandate-gateway.json` |
| `agent.id` | The agent it was issued to. An id, not a key |
| `audience` | The base address of the one store it is for (scheme, host and path, no trailing slash), or `null` |
| `issuedAt`, `expiresAt` | ISO 8601 times, 15 minutes apart |
| `mandates[]` | One entry for each mandate in force for the agent |
| `mandates[].id`, `.rulesHash` | The mandate's id and the SHA-256 of its rules |
| `mandates[].currency` | ISO 4217 code. Amounts are in cents of it |
| `mandates[].remainingCents` | Budget left when the credential was issued |
| `mandates[].perPurchaseLimitCents` | Most for one purchase, or `null` |
| `mandates[].approvalThresholdCents` | The ask-first amount: above it the buyer must approve. Or `null` |
| `mandates[].allowedCategories` | What the agent may buy, as short product categories |
| `mandates[].merchantPolicy` | `verified_only`, `allowlist` or `any_registered` |
| `mandates[].allowedMerchants` | The named stores when the policy is `allowlist`; otherwise empty |
| `mandates[].expiresAt` | When the mandate ends |
| `neverBuy` | Stores the buyer said never to buy from |
| `note` | A reminder that the credential authorises nothing by itself |

**Signing.** `signature` is a base64 Ed25519 signature over the canonical JSON of `payload`, as UTF-8. Canonical JSON here means: object keys sorted, no whitespace, arrays in order, keys whose value is undefined left out, everything else as `JSON.stringify` writes it.

**Verifying.** A store reads the gateway's public key once from `/.well-known/mandate-gateway.json` (`evidence.publicKey`, PEM) and keeps it. For each credential it then checks, with no network call: the signature over the canonical payload; that every field above is present and well formed; that `issuer` is the gateway it trusts; that `expiresAt` has not passed and the lifetime is no more than an hour; and that `audience` equals its own base address. A credential with no audience is rejected by stores. The whole check is in [`src/lib/stores/verify-mandate.ts`](src/lib/stores/verify-mandate.ts), which depends only on Node's crypto module, so a store can copy the file as it is. The developers page (`/developers#credential`) has a short sample.

## For merchants

Stores join in the merchant portal (`/for-merchants`), which is separate from a shopper's dashboard and needs no account. A store has one of three standings:

| Standing | How a store gets it | What it allows |
|---|---|---|
| Ownership not proved | Someone enters the store's address. | Nothing. It cannot be paid. |
| Registered | The store serves one JSON file at `<store URL>/.well-known/mandate-merchant.json` with the token the gateway issued, its name and its PayPal payee, and the gateway reads it. | Purchases under mandates that name the store or accept any registered store. |
| Verified | The gateway's operator reviews the store and grants it at `/operator` (opened with `OPERATOR_KEY`). A store cannot give it to itself. | Purchases under mandates that say "known merchants only". |

A store is managed from the browser that proved it owns the site, and that browser sees the store's agent sales report. On a new browser the seller registers the same address again, gets a token of their own, and publishing it moves the store to that browser. The file can also say where to send paid orders and return requests, where the catalogue is, and whether the store accepts reserved payments. The gateway refuses private addresses, requires https, and only accepts callback URLs under the store's own address. Operator decisions are written to the signed ledger.

A store can also read an agent's mandate credential (see "The mandate credential" above). Each demo store has a `present_mandate` tool on its catalogue server (`/stores/<name>/mcp`) and the same check as plain HTTP at `POST /stores/<name>/api/mandate`. The store verifies the credential against the gateway key it has pinned, without calling the gateway. It rejects one that was changed, has expired, or was issued for another store, and says why. Otherwise it answers with its own reading: whether the mandate's store rule covers it as far as it can tell, which of its products are inside the stated categories and limits, which would need the buyer's approval, and which are outside. The match is on the catalogue's category and price only. It authorises nothing: the gateway still decides every purchase.

Two demo shops live outside this repository, each with its own deployment, join the same way any outside merchant would, and check credentials the same way (`present_mandate` on `/mcp`, and `POST /api/mandate`): [Tidewater Coffee Roasters](https://tidewater-coffee-pi.vercel.app) ([source](https://github.com/Bhaskar422/tidewater-coffee)) and [Fern & Field](https://fern-and-field.vercel.app) ([source](https://github.com/Bhaskar422/fern-and-field)).

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
- **Orders v2** (`/v2/checkout/orders` with `payment_source.paypal.vault_id`): each approved purchase is created against the vault token with the merchant as payee, either captured at once or authorized and captured on shipment. The store adds its tracking number to the order (`/v2/checkout/orders/{id}/track`), and the gateway reads orders back to reconcile its ledger.
- **Payments v2 authorizations** (`/v2/payments/authorizations/{id}/capture` and `/void`): the gateway captures a reservation when the store ships; the store releases it if the buyer cancels first.
- **Payments v2** (`/v2/payments/captures/{id}/refund`): the merchant refunds from its own account.
- **Customer Disputes v1** (list, show, `provide-evidence`, `accept-claim`, `send-message`, and the sandbox-only `adjudicate`): the merchant's agent answers disputes.
- **Webhooks** (`PAYMENT.CAPTURE.*`, `CUSTOMER.DISPUTE.*`) with signature verification through `/v1/notifications/verify-webhook-signature`.

## The evidence ledger

Each entry stores its type, payload and timestamp, the previous entry's hash, its own SHA-256 hash, and an Ed25519 signature over that hash. Editing, removing or reordering any row breaks verification, and the dashboard has a button that re-checks the whole chain.

For one purchase the record holds the mandate text and rules hash, the user's request, the agent's stated reason, the product page as the gateway fetched it (with a hash of the page), every policy check, the user's approval if one was needed, the PayPal order and capture IDs, and anything that happened afterwards. A merchant verifies it against the public key at `/.well-known/mandate-gateway.json`.

## Try it

**In the hosted demo**

1. Open https://mandate-gateway.vercel.app and click **Link PayPal**. Log in with a US PayPal sandbox personal account.
   With no PayPal sandbox account, choose **Use the demo wallet** instead, when the operator has set one up.
2. Build a mandate from the choices on the Mandates page, or write one in your own words, and confirm the rules.
3. Open **Assistant** and ask it to buy running shoes. That is the quickest way to see a purchase paid, held for approval or blocked.
4. To use your own agent instead, click **Connect an agent**. The key screen has ready-made setup for ChatGPT, Claude Code, Claude Desktop, Codex CLI, Cursor, Gemini CLI, VS Code, any other MCP client, and plain REST. It adds the gateway and the demo stores' catalogues.

The demo stores are at `/stores/stride` (verified), `/stores/kickz` (not verified) and `/stores/peak` (unknown to the gateway until it registers). Each has a back office at `/stores/<name>/admin` where you can ship an order correctly or ship the wrong item.

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
pnpm test                                             # unit tests: policy engine, page scanner, evidence ledger, mandate credential
pnpm exec tsx --env-file=.env.local scripts/e2e.ts    # end-to-end checks over MCP and REST against a running server
pnpm exec tsx --env-file=.env.local scripts/mandate-adversarial.ts   # hostile and ambiguous mandate texts through the compiler and the code check
pnpm exec tsx --env-file=.env.local scripts/hold-check.ts            # reserve, charge on shipment, cancel, each compared with PayPal
```

The end-to-end script drives the gateway as an agent would. It covers the approved, blocked, injected and refunded paths, the kill switch and automatic agent pause, the REST API and dry run, safe retries, scoped mandates, both settlement outcomes, merchant onboarding, credentials, key rotation and ledger tamper detection. It passes against the hosted deployment with real sandbox payments. `scripts/gullible-agent.ts` is a deliberately naive agent that obeys instructions found in product text, for demonstrating the injection block.

## Agent tests and the baseline

`agent-tests/` runs reference shopping agents in nine frameworks (Anthropic SDK, Claude Agent SDK, Vercel AI SDK, LangGraph in TypeScript and Python, CrewAI, Pydantic AI, OpenAI Agents SDK, Google ADK), three designs (single agent, planner and executor, shopper and buyer) and six scenarios against a test copy of the gateway. All 204 runs pass, and nothing the mandate forbids was paid in any of them. Every run, with its tool calls and the gateway's decisions, can be browsed at [`/developers/tests`](https://mandate-gateway.vercel.app/developers/tests).

The same agents were also run with no gateway, using PayPal's Agent Toolkit to create orders directly and the mandate given only as text in the prompt (294 runs):

| Condition | Orders outside the mandate | Runs affected |
|---|---|---|
| Toolkit, plain prompt | $540 | 4 of 147 |
| Toolkit, strongly worded prompt | $0 | 0 of 147 |
| Mandate gateway | $0 | 0 of 135 |

All four were the same mistake, in the two multi-agent designs: the agent ordered a $135 shoe without asking, though the mandate says to ask above $100. These are orders created, not money captured, and the samples are small (three to five runs per cell). A careful prompt matched the gateway on these scenarios; the difference is that the gateway's result does not depend on the prompt.

## Layout

- [`src/lib/policy.ts`](src/lib/policy.ts): the policy engine (pure, deterministic)
- [`src/lib/risk.ts`](src/lib/risk.ts): the page scanner for text aimed at AI agents
- [`src/lib/gateway.ts`](src/lib/gateway.ts): purchase, approval, payment, settlement and account flows
- [`src/lib/merchants.ts`](src/lib/merchants.ts): merchant registration, proof of ownership and operator review
- [`src/lib/agent-api.ts`](src/lib/agent-api.ts): what agents see, shared by the MCP server and the REST API ([`src/app/api/v1`](src/app/api/v1))
- [`src/lib/mandate-check.ts`](src/lib/mandate-check.ts): the code check on drafted mandate rules
- [`src/lib/reconcile.ts`](src/lib/reconcile.ts): comparing a purchase with PayPal's record
- [`src/lib/ledger.ts`](src/lib/ledger.ts): the evidence ledger
- [`src/lib/paypal.ts`](src/lib/paypal.ts): Vault, Orders, refunds, Disputes, webhook verification
- [`src/lib/assistant.ts`](src/lib/assistant.ts): the built-in shopping assistant (a Claude tool loop over the agent API)
- [`src/lib/llm.ts`](src/lib/llm.ts): mandate compiler, product classifier, problem analysis (Claude)
- [`src/app/api/mcp`](src/app/api/mcp/route.ts): the gateway's MCP server
- [`src/lib/stores/merchant.ts`](src/lib/stores/merchant.ts): the merchant side: order intake, returns agent, dispute agent
- [`src/app/stores`](src/app/stores): the three demo merchants

Stack: Next.js 15, TypeScript, PostgreSQL with Drizzle, the Model Context Protocol, Claude, deployed on Vercel with Neon.

## Limits of this build

- **Sandbox only.** It has never run against live PayPal. Paying a third-party merchant from a vaulted wallet works in the sandbox as built; in production we expect it to need PayPal's partner onboarding for each merchant.
- **The demo merchants live in the same app as the gateway.** They talk to it over HTTP and verify its signatures, but they share its database and deployment. The third store, Peak, borrows Stride's sandbox PayPal account.
- **The page scanner is a set of patterns.** It catches the common phrasings of injected instructions, not every possible one. It is a second line behind the limits, which do not depend on it.
- **Settlement is rule-based on both sides.** The store's returns policy and the user's acceptance rules are fixed rules; a model only classifies the buyer's complaint.
- **A PayPal buyer cannot open a dispute through the API.** The buyer opens it in PayPal's Resolution Center; everything after that is automated on the merchant's side.
- **The sandbox has no human reviewer**, so the final ruling in the dispute demo is triggered with PayPal's sandbox-only `adjudicate` call.
- **A dashboard is an anonymous cookie until PayPal is linked.** After that the PayPal account identifies it. There is no second factor beyond PayPal's own login.
- **The built-in assistant calls the gateway's functions in-process** rather than over HTTP with a key. It passes through the same policy checks, but not the network path an outside agent uses.
- **A merchant fetches the evidence record by presenting the PayPal capture ID**, which is weaker than real merchant authentication. The same goes for reporting a shipment, which presents the authorization ID.
- **A seller has no login.** A store is tied to the browser that last proved ownership of its site.

MIT licensed.
