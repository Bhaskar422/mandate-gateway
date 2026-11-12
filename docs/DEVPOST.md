# Devpost write-up

Paste-ready text for the submission form. Every number here comes from a run recorded in this repository; the sources are listed at the end.

## Form fields

**Project name:** Mandate Gateway

**Elevator pitch** (174 characters; the form allows 200):

```text
Proof for every agent purchase on PayPal: agents buy inside rules the buyer set, and a signed record of every step gets the buyer a refund and lets the store win the dispute.
```

**Built with:**

```text
paypal, next.js, typescript, react, postgresql, neon, vercel, drizzle, model-context-protocol, claude, anthropic, channel3, tailwindcss, python, openai, gemini
```

**Links:**

- Live demo: https://mandate.mindgears.dev
- Source: https://github.com/Bhaskar422/mandate-gateway
- Every test run: https://mandate.mindgears.dev/developers/tests
- Two outside demo stores: https://tidewater-coffee-pi.vercel.app and https://fern-and-field.vercel.app

## Inspiration

PayPal made it possible for AI agents to pay. Most of the attention since has gone to stopping an agent from overspending. That matters, but it is half the problem. The other half starts after the money moves: the wrong item arrives, or a buyer disputes a charge, and nobody can show what the buyer actually authorised, what the store's page said, or what the agent was asked to do. We wanted every agent purchase to come with proof that both sides can use.

## What it does

Mandate is a gateway between any AI shopping agent and the buyer's PayPal account. The agent never holds payment credentials. It can only ask.

**For the buyer**

- Write a mandate in plain English ("up to $150 on running shoes, known stores only, ask me above $100"), or build it from a few choices. A model drafts the rules, code checks them against the buyer's own words, and the gateway asks about anything left open. Before confirming, the buyer sees made-up purchases run through the real checks.
- Agents connect over MCP or REST. For each request the gateway looks the store up in its own registry, reads the product page itself, checks the mandate in code, then pays from the buyer's saved PayPal wallet, asks the buyer first, or blocks with a reason.
- Optionally, PayPal only reserves the money and the buyer is charged when the store ships. Until then the buyer can cancel, and an unshipped reservation is released automatically after three days.
- When something goes wrong, the buyer reports it once. The gateway sends the store the signed record and settles a refund, a part refund or a replacement inside rules the buyer set.

**For the store**

- A store joins by itself: it registers its address and publishes one file to prove it owns the site. An operator review grants "verified".
- It receives a signed record of every paid order and checks the gateway's signature before shipping.
- If a buyer opens a PayPal dispute, the store's agent answers it through the Disputes API with that signed record as evidence.
- Before a complaint becomes a dispute, the gateway compares its signed record with the store's own order book and shows the buyer whose account the two records support. Most are settled there, by the records.
- A store can check a buyer's mandate by itself: the agent presents a signed credential bound to that store, and the store verifies it offline with the gateway's public key, with no call to the gateway.
- A store that has not joined can see what it is missing: when the assistant finds a product at such a store (through Channel3's catalogue) it cannot buy it, and the merchants page counts those by store.
- It sees an agent sales report: revenue, blocked requests grouped by the rule that stopped them, and suggestions such as "13 requests worth $1,820 were blocked only because the store is not verified".

**For both**

Every step is written to a hash-chained, Ed25519-signed ledger. Anyone can verify a record without an account, and any purchase can be compared fact by fact with PayPal's own record of the order.

## How we used Channel3

A payment gateway for agents has a cold start: it is only useful at the stores that have joined. We used Channel3's product search to deal with both sides of that.

- **For the shopper:** when none of the joined stores sells what was asked for, the assistant searches Channel3's catalogue and reports real products with the store, price and link. It says plainly that it cannot buy them, because the gateway only pays stores that have registered and proved who they are. Asked for an electric gooseneck kettle on the live site, it found six, one of them at $39.95.
- **For the store:** each of those results is counted against the store it came from, with no shopper and no request text kept. The merchants page shows "Where agents looked and could not buy": the stores, how many products agents found there, and the list prices added up. A store that has not joined sees demand it is missing, in dollars, on the page where it can register.
- **The line we kept:** Channel3 decides what the assistant can find, never what the gateway will pay. Finding a product does not make its store payable.

## How we built it

Next.js 15 and TypeScript on Vercel, PostgreSQL on Neon with Drizzle, and the Model Context Protocol for the agent interface, with a REST API beside it.

PayPal: Vault v3 saves the wallet once. Orders v2 pays the store directly from the vault token, either captured at once or authorized and captured on shipment. Payments v2 handles refunds, captures and releases. The store adds tracking to the order. Customer Disputes v1 carries the evidence. Webhooks are signature-checked. PayPal's Agent Toolkit is used in the evaluation as the no-gateway baseline.

Claude drafts mandates, classifies products and frames problem reports. The design rule is that a model can only narrow what is allowed. Limits, payees, stores and expiry are enforced by a deterministic policy engine, so a prompt injection can change what an agent asks for but cannot raise a limit or change who gets paid.

## Challenges we ran into

- Default sandbox accounts could not save a wallet; it needed US business and US personal accounts.
- Paying a third-party store directly from a saved wallet, and having that store refund from its own account.
- Only the store can release a reservation. PayPal refused the gateway's own attempt, so cancelling became a request to the store.
- Answering a dispute end to end: evidence as a PDF, tracking, and PayPal's link relations.
- A page scanner strict enough to catch hidden instructions without flagging ordinary product copy.
- An honest baseline. Our first comparison showed no difference with and without the gateway. The difference only appeared in the planner and multi-agent designs, and we report it at its real size.

## Accomplishments that we're proud of

- Everything runs against the PayPal sandbox with real sandbox money: payments, reservations, refunds, part refunds and a dispute resolved in the seller's favour.
- Agents in nine frameworks (Anthropic SDK, Claude Agent SDK, Vercel AI SDK, LangGraph in TypeScript and Python, CrewAI, Pydantic AI, OpenAI Agents SDK, Google ADK), three designs and six scenarios: 204 of 204 runs pass, and nothing the mandate forbids was paid in any of them. Every run can be browsed with its tool calls and the gateway's decisions.
- The same agents with no gateway, using PayPal's Agent Toolkit and the mandate as text in the prompt, created $540 of orders the mandate forbids in 4 of 147 runs. With the gateway: $0. A strongly worded prompt also reached $0, so the claim we make is narrower: the gateway's result does not depend on the prompt.
- One model followed a product page's hidden instruction and asked for a $100 gift card. The gateway blocked it.
- 44 end-to-end checks pass on the live deployment, plus 77 unit tests and 14 hostile or ambiguous mandate texts.
- Two demo stores live in their own repositories and deployments and join the way any outside merchant would.

## What we learned

Agent safety for payments is not a prompting problem. The useful boundary is between what a model may judge (is this a running shoe?) and what code must decide (how much, to whom, until when). And evidence is worth as much as enforcement: the record that blocks a bad purchase is the same record that settles a refund or wins a dispute.

## What's next for Mandate Gateway

- Production PayPal, with partner onboarding for stores.
- Signed requests from the outside stores too: the demo stores inside the app sign today, and the two outside ones have the support but no key set.
- Telling a store found through Channel3 what agents wanted from it, so the list of missed demand becomes an invitation to join.
- Mandate-sorted search at outside stores: the in-app stores already rank their catalogue by a presented credential.

## Where the numbers come from

| Number | Source |
|---|---|
| 204 of 204 agent runs | `agent-tests/RESULTS.md`, browsable at `/developers/tests` |
| $540 in 4 of 147 runs; $0 with the gateway | `agent-tests/results/baseline.json` (orders created, not captured; three to five runs per cell) |
| 44 end-to-end checks | `scripts/e2e.ts` against the live deployment |
| 77 unit tests | `pnpm test` |
| 14 mandate texts | `scripts/mandate-adversarial.ts` |
| Reserve, charge on shipment, cancel, automatic release | `scripts/hold-check.ts` |
