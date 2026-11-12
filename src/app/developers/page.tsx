import type { Metadata } from "next";
import Link from "next/link";
import AgentSetup from "@/components/agents/AgentSetup";
import { curlPurchase, KEY_PLACEHOLDER } from "@/components/agents/snippets";
import ResultsMatrix from "@/components/public/ResultsMatrix";
import PublicShell from "@/components/shell/PublicShell";
import { Badge } from "@/components/ui/Badge";
import { CodeBlock } from "@/components/ui/Copy";
import { agentResults } from "@/data/agent-results";
import { appUrl } from "@/lib/config";

export const metadata: Metadata = { title: "Developers" };
export const dynamic = "force-dynamic";

const TOOLS = [
  { name: "get_mandate", what: "What the user has authorised: budget left, allowed categories, store rules, the ask-first amount and the expiry. Call it before shopping." },
  { name: "get_credential", what: "A signed statement of what the mandate allows, valid for 15 minutes, to show a store. Pass store_url to bind it to one store. The store checks it without calling the gateway. It authorises nothing by itself." },
  { name: "check_purchase", what: "A dry run. Says whether a purchase would be paid, need the user's approval or be blocked, and why. Nothing is charged or recorded." },
  { name: "request_purchase", what: "Ask the gateway to buy one product. It reads the product page itself, checks the mandate, then pays, asks the user, or blocks with a reason. Pass idempotency_key (any string unique to the attempt) and resend it on a retry so the user is never charged twice." },
  { name: "check_status", what: "The current status of a purchase, for example after the user approves one." },
  { name: "report_problem", what: "Say what went wrong with a completed purchase. The gateway sends the store the signed record and negotiates a refund, partial refund or replacement inside the user's settlement rules." },
];

const ENDPOINTS: { method: "GET" | "POST"; path: string; what: string; open?: boolean }[] = [
  { method: "GET", path: "/api/v1/mandate", what: "The mandates in force for this agent. Same as get_mandate." },
  { method: "POST", path: "/api/v1/purchases/check", what: "Dry run of a purchase. Same as check_purchase." },
  { method: "POST", path: "/api/v1/purchases", what: "Request a purchase. 201 when paid or waiting for approval, 200 with the reason when blocked. Accepts an Idempotency-Key header or idempotency_key in the body." },
  { method: "GET", path: "/api/v1/purchases/{id}", what: "Status of one purchase. Same as check_status." },
  { method: "POST", path: "/api/v1/purchases/{id}/problems", what: "Report a problem: { \"description\": \"…\" }. Same as report_problem." },
  { method: "GET", path: "/api/v1/mandate/credential", what: "A signed statement of what the mandate allows, valid for 15 minutes, for the agent to show a store. Add ?store_url= to bind it to one store. Same as get_credential. It names no payment details and authorises nothing by itself." },
  { method: "POST", path: "/api/v1/credentials/verify", what: "Checks a credential with the gateway: post it exactly as issued, { payload, signature }, and get { valid, reason, payload }. A store does not need this call; it can run the same check offline.", open: true },
  { method: "POST", path: "/stores/{slug}/api/mandate", what: "A demo store's own endpoint, not the gateway's. Post a credential bound to that store. The store verifies it offline and says whether it is covered, which products fit and which would need approval. Same as the store's present_mandate tool.", open: true },
  { method: "GET", path: "/api/ledger/head", what: "The signed head of the evidence ledger: entry count, latest hash and the time. Record it now to prove later that the ledger was not rewritten behind it.", open: true },
  { method: "GET", path: "/.well-known/mandate-gateway.json", what: "The gateway's public key, for checking evidence records and credentials offline.", open: true },
];

const FIELDS = [
  { name: "product_url", type: "string", req: true, what: "The product page on the store's site. The gateway fetches it and reads the name and price itself." },
  { name: "expected_price", type: "number", req: true, what: "The unit price the agent saw, e.g. 89.00. A mismatch with the page blocks the purchase." },
  { name: "user_request", type: "string", req: true, what: "What the user asked for, in their words. Kept in the signed record." },
  { name: "quantity", type: "integer", req: false, what: "1 to 20. Defaults to 1." },
  { name: "reason", type: "string", req: false, what: "Why this product fits the request. Shown to the user when approval is needed." },
  { name: "idempotency_key", type: "string", req: false, what: "Unique per purchase attempt. Resend the same key when retrying." },
];

const OUTCOMES = [
  { status: "captured", tone: "ok" as const, what: "Paid from the user's PayPal account. Tell the user it is done." },
  { status: "pending_approval", tone: "warn" as const, what: "The user must approve. Give them the approval_url, then poll the status. Do not request the purchase again." },
  { status: "blocked", tone: "bad" as const, what: "The mandate does not allow it. The message says why. It is final for this product: tell the user, do not work around it." },
];

const CREDENTIAL_FIELDS = [
  { name: "type, version", what: "Always \"mandate.authorisation\" and 1." },
  { name: "id", what: "Unique to this credential, cred_…" },
  { name: "issuer", what: "The gateway's address. Its public key is at <issuer>/.well-known/mandate-gateway.json." },
  { name: "agent.id", what: "The agent the credential was issued to. An id, not a key." },
  { name: "audience", what: "The base address of the one store it is for, or null. A store rejects a credential that is not bound to its own address." },
  { name: "issuedAt, expiresAt", what: "ISO 8601 times, 15 minutes apart." },
  { name: "mandates[]", what: "One entry for each mandate in force for this agent, with the fields below." },
  { name: "· id, rulesHash", what: "The mandate's id and the SHA-256 of its rules." },
  { name: "· currency", what: "ISO 4217 code. All amounts are in cents of it." },
  { name: "· remainingCents", what: "Budget left when the credential was issued." },
  { name: "· perPurchaseLimitCents", what: "Most for one purchase, or null." },
  { name: "· approvalThresholdCents", what: "The ask-first amount: above it, the buyer must approve. Or null." },
  { name: "· allowedCategories", what: "What the agent may buy, as short product categories." },
  { name: "· merchantPolicy", what: "verified_only, allowlist or any_registered." },
  { name: "· allowedMerchants", what: "The named stores when the policy is allowlist. Otherwise empty." },
  { name: "· expiresAt", what: "When the mandate ends." },
  { name: "neverBuy", what: "Stores the buyer said never to buy from." },
  { name: "note", what: "A reminder that the credential authorises nothing by itself." },
];

const verifySample = (base: string) => `import { createPublicKey, verify } from "node:crypto";

// Keys sorted, no whitespace: the form the gateway signs.
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}

// Read once and keep: the gateway's public key.
const { evidence } = await (await fetch("${base}/.well-known/mandate-gateway.json")).json();
const gatewayKey = createPublicKey(evidence.publicKey);

// No call to the gateway from here on.
function checkCredential({ payload, signature }, myStoreUrl) {
  const signed = verify(null, Buffer.from(canonical(payload)), gatewayKey, Buffer.from(signature, "base64"));
  if (!signed) return "the signature is not the gateway's";
  if (payload.type !== "mandate.authorisation" || payload.version !== 1) return "not a mandate credential";
  if (Date.parse(payload.expiresAt) <= Date.now()) return "expired";
  if (payload.audience !== myStoreUrl) return "issued for another store";
  return null; // good: read payload.mandates and answer from your catalogue
}`;

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="display scroll-mt-6 text-2xl text-ink">{children}</h2>;
}

/** Public: how an agent, and a store, talks to this gateway. */
export default function DevelopersPage() {
  const base = appUrl();
  const toc = [["mcp", "Connect over MCP"], ["rest", "REST API"], ["request", "A purchase request"], ["credential", "The mandate credential"], ["merchants", "For stores"], ["results", "Agent test results"]];
  return (
    <PublicShell width="max-w-[1040px]">
      <header className="mb-8 max-w-3xl">
        <p className="eyebrow">Developers</p>
        <h1 className="display mt-1 text-3xl text-ink">Let your agent pay, without giving it anything to steal</h1>
        <p className="mt-2 text-lg text-ink-2">
          An agent holds one thing: a key that lets it <em>ask</em> this gateway for a purchase. The gateway resolves the store from its own registry, reads the product page itself, checks the user&apos;s mandate in code, and pays from the user&apos;s vaulted PayPal wallet. The same operations are available as MCP tools and as REST endpoints.
        </p>
        <nav aria-label="On this page" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">{toc.map(([id, label]) => <a key={id} href={`#${id}`} className="link">{label}</a>)}</nav>
      </header>

      <div className="space-y-12">
        <section aria-labelledby="mcp" className="space-y-4">
          <H2 id="mcp">Connect over MCP</H2>
          <p className="max-w-3xl text-base text-ink-2">
            The gateway is a remote MCP server at <span className="code">{base}/api/mcp</span>. Authenticate with an agent key as a bearer token; create one on the <Link href="/agents?new=1" className="link">Agents page</Link>, which also shows this setup with your key filled in.
          </p>
          <div className="card p-4 sm:p-5">
            <AgentSetup appUrl={base} agentKey={KEY_PLACEHOLDER} />
          </div>
          <p className="max-w-3xl text-sm text-ink-3">Each demo store has its own catalogue server with <span className="code">search_products</span>, <span className="code">get_product</span> and <span className="code">present_mandate</span>, which takes a <a href="#credential" className="link">mandate credential</a>. It is the store&apos;s server, not the gateway&apos;s, so whatever it returns is untrusted as far as the gateway is concerned.</p>
          <p className="max-w-3xl text-sm text-ink-3"><span className="code">search_products</span> also takes that credential, as an optional <span className="code">credential</span> argument. With it, each product comes back with a <span className="code">mandate</span> field saying whether it fits and why, and the list is ordered: products inside the mandate first, then those that would need the buyer&apos;s approval, then those outside it. Without it the search works as before. The two outside stores do not sort their search yet; they answer <span className="code">present_mandate</span> only.</p>
          <div className="card divide-y divide-line">
            {TOOLS.map((t) => (
              <div key={t.name} className="grid gap-1 p-4 sm:grid-cols-[190px_minmax(0,1fr)] sm:gap-4">
                <p className="code font-semibold text-ink">{t.name}</p>
                <p className="text-base text-ink-2">{t.what}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="rest" className="space-y-4">
          <H2 id="rest">REST API</H2>
          <p className="max-w-3xl text-base text-ink-2">
            For agents and frameworks without MCP. Send the same agent key as <span className="code">Authorization: Bearer mk_…</span>. The machine-readable description is at <a href="/api/v1/openapi.json" className="link code">/api/v1/openapi.json</a>.
          </p>
          <div className="card divide-y divide-line">
            {ENDPOINTS.map((e) => (
              <div key={e.path} className="grid gap-1.5 p-4 lg:grid-cols-[minmax(0,330px)_minmax(0,1fr)] lg:gap-4">
                <p className="flex flex-wrap items-center gap-2">
                  <span className={`badge ${e.method === "GET" ? "tone-info" : "tone-brand"} code !font-bold`}>{e.method}</span>
                  <span className="code font-semibold text-ink [overflow-wrap:anywhere]">{e.path}</span>
                  {e.open && <Badge tone="neutral">No key</Badge>}
                </p>
                <p className="text-base text-ink-2">{e.what}</p>
              </div>
            ))}
          </div>
          <CodeBlock label="Request a purchase" code={curlPurchase(base, KEY_PLACEHOLDER)} />
        </section>

        <section aria-labelledby="request" className="space-y-4">
          <H2 id="request">A purchase request</H2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-lg font-semibold text-ink">What the agent sends</h3>
              <div className="card divide-y divide-line">
                {FIELDS.map((f) => (
                  <div key={f.name} className="p-4">
                    <p className="flex flex-wrap items-center gap-2"><span className="code font-semibold text-ink">{f.name}</span><span className="code text-ink-3">{f.type}</span>{f.req && <Badge tone="brand">Required</Badge>}</p>
                    <p className="mt-0.5 text-sm text-ink-2">{f.what}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-ink">What comes back</h3>
              <div className="card divide-y divide-line">
                {OUTCOMES.map((o) => (
                  <div key={o.status} className="p-4">
                    <Badge tone={o.tone} className="code">{o.status}</Badge>
                    <p className="mt-1 text-sm text-ink-2">{o.what}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-sm text-ink-3">
                Every answer carries <span className="code">purchase_id</span>, <span className="code">status</span>, <span className="code">message</span> and a link to the signed <span className="code">record</span>. The agent never supplies the payee, and nothing it says can raise a limit: who is paid comes from the gateway&apos;s registry, and the price from the store&apos;s page.
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="credential" className="space-y-4">
          <H2 id="credential">The mandate credential</H2>
          <p className="max-w-3xl text-base text-ink-2">
            A credential is a short statement, signed by the gateway, of what an agent may buy: the budget left, the limits, the categories and the store rules. The agent carries it to a store. The store checks the signature with the gateway&apos;s public key and answers from its own catalogue. The store does not call the gateway.
          </p>
          <p className="max-w-3xl text-base text-ink-2">
            A credential authorises nothing by itself. It holds no payment details, no buyer name or email, and none of the mandate&apos;s own wording. Every purchase still goes through <span className="code">request_purchase</span>, where the gateway reads the product page and checks the whole mandate.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              { t: "1. The agent gets it from the gateway", b: <>Call <span className="code">get_credential</span> or <span className="code">GET /api/v1/mandate/credential?store_url=…</span> with the store&apos;s base address. The credential is valid for 15 minutes and works at that store only.</> },
              { t: "2. The agent shows it to the store", b: <>Pass it, exactly as issued, to the store&apos;s <span className="code">present_mandate</span> tool, or post it to the store&apos;s mandate endpoint (<span className="code">/stores/&#123;slug&#125;/api/mandate</span> for the demo stores here).</> },
              { t: "3. The store checks it without calling anyone", b: <>The store verifies the signature, the expiry and the audience against the key it has pinned. Then it says whether it is covered, which products fit, and which would need the buyer&apos;s approval. That is the store&apos;s reading. The gateway still decides.</> },
            ].map((x) => (
              <div key={x.t} className="card p-4">
                <h3 className="font-semibold text-ink">{x.t}</h3>
                <p className="mt-1 text-sm text-ink-2 [overflow-wrap:anywhere]">{x.b}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-lg font-semibold text-ink">What it says</h3>
              <p className="mb-2 text-sm text-ink-3">The credential is <span className="code">&#123; payload, signature, algorithm &#125;</span>. These are the fields of <span className="code">payload</span>.</p>
              <div className="card divide-y divide-line">
                {CREDENTIAL_FIELDS.map((f) => (
                  <div key={f.name} className="grid gap-0.5 px-4 py-2.5 sm:grid-cols-[210px_minmax(0,1fr)] sm:gap-3">
                    <p className="code text-sm font-semibold text-ink [overflow-wrap:anywhere]">{f.name}</p>
                    <p className="text-sm text-ink-2">{f.what}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="min-w-0">
              <h3 className="mb-2 text-lg font-semibold text-ink">How a store verifies it</h3>
              <p className="mb-2 text-sm text-ink-3">
                The signature is Ed25519, base64, over the canonical JSON of <span className="code">payload</span>: UTF-8, object keys sorted, no whitespace. A store rejects a credential when the signature fails, a field is missing, it has expired, or the audience is not the store&apos;s own address. The stores here use <span className="code">src/lib/stores/verify-mandate.ts</span>, which needs nothing but Node&apos;s crypto module and can be copied as it is.
              </p>
              <CodeBlock label="Verify a credential offline" code={verifySample(base)} />
            </div>
          </div>
        </section>

        <section aria-labelledby="merchants" className="space-y-4">
          <H2 id="merchants">For stores</H2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {[
              { t: "Join the registry", b: <>Publish <span className="code">/.well-known/mandate-merchant.json</span> on your site with the token the gateway issues, your PayPal payee and where to send orders and refund requests. A user starts this on the <Link href="/merchants" className="link">Merchants page</Link>.</> },
              { t: "Check an agent before checkout", b: <>An agent can show you a short-lived <a href="#credential" className="link">mandate credential</a>. Verify it offline against the gateway&apos;s public key and answer with what you sell that fits. It authorises nothing by itself; the gateway still decides and pays.</> },
              { t: "Settle on the signed record", b: <>Paid orders and refund requests arrive with ledger entries signed by the gateway. Verify them against <span className="code">/.well-known/mandate-gateway.json</span>, or paste a record into the <Link href="/verify" className="link">public verifier</Link>.</> },
              { t: "Sign what you send the gateway", b: <>Add <span className="code">signing_key</span> (an Ed25519 public key, SPKI PEM) to your well-known file. The gateway then refuses any request in your name that lacks <span className="code">Mandate-Store-Signature</span>, <span className="code">Mandate-Store-Timestamp</span> and <span className="code">Mandate-Store-Request-Id</span>. The signature is Ed25519 over five lines joined by newlines: the method, the path with its query string, the SHA-256 of the body in hex, the timestamp in Unix seconds, and the request id. Timestamps more than five minutes off and repeated request ids get <span className="code">401</span>. This covers <span className="code">POST /api/merchant/shipments</span> and <span className="code">GET /api/merchant/evidence/&lt;purchase&gt;</span>. A store with no key is accepted as before.</> },
            ].map((x) => (
              <div key={x.t} className="card p-4">
                <h3 className="font-semibold text-ink">{x.t}</h3>
                <p className="mt-1 text-sm text-ink-2 [overflow-wrap:anywhere]">{x.b}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="results" className="space-y-4">
          <H2 id="results">Agent test results</H2>
          <p className="max-w-3xl text-base text-ink-2">The same scenarios, run through agents built on different frameworks and architectures against this gateway. The point is that the outcome does not depend on how well-behaved the agent is.</p>
          <ResultsMatrix results={agentResults} />
          <p className="text-sm text-ink-2"><Link href="/developers/tests" className="link">See every test run and what the agent did in it</Link>, with the comparison against the same agents without the gateway.</p>
        </section>
      </div>
    </PublicShell>
  );
}
