import type { Metadata } from "next";
import Link from "next/link";
import AgentSetup from "@/components/agents/AgentSetup";
import { curlPurchase, KEY_PLACEHOLDER } from "@/components/agents/snippets";
import BaselineComparison from "@/components/public/BaselineComparison";
import ResultsMatrix from "@/components/public/ResultsMatrix";
import PublicShell from "@/components/shell/PublicShell";
import { Badge } from "@/components/ui/Badge";
import { CodeBlock } from "@/components/ui/Copy";
import { agentBaseline } from "@/data/agent-baseline";
import { agentResults } from "@/data/agent-results";
import { appUrl } from "@/lib/config";

export const metadata: Metadata = { title: "Developers" };
export const dynamic = "force-dynamic";

const TOOLS = [
  { name: "get_mandate", what: "What the user has authorised: budget left, allowed categories, store rules, the ask-first amount and the expiry. Call it before shopping." },
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
  { method: "GET", path: "/api/v1/mandate/credential", what: "A signed proof, valid for 15 minutes, that this agent is authorised to buy for a user and within what bounds. The agent can show it to a store before checkout. It names no payment details and authorises nothing by itself." },
  { method: "POST", path: "/api/v1/credentials/verify", what: "A store posts a credential back exactly as issued, { payload, signature }, and gets { valid, reason, payload }.", open: true },
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

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="display scroll-mt-6 text-2xl text-ink">{children}</h2>;
}

/** Public: how an agent, and a store, talks to this gateway. */
export default function DevelopersPage() {
  const base = appUrl();
  const toc = [["mcp", "Connect over MCP"], ["rest", "REST API"], ["request", "A purchase request"], ["merchants", "For stores"], ["results", "Agent test results"]];
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
          <p className="max-w-3xl text-sm text-ink-3">Each demo store has its own catalogue server with <span className="code">search_products</span> and <span className="code">get_product</span>. It is the store&apos;s server, not the gateway&apos;s, so whatever it returns is untrusted as far as the gateway is concerned.</p>
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

        <section aria-labelledby="merchants" className="space-y-4">
          <H2 id="merchants">For stores</H2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              { t: "Join the registry", b: <>Publish <span className="code">/.well-known/mandate-merchant.json</span> on your site with the token the gateway issues, your PayPal payee and where to send orders and refund requests. A user starts this on the <Link href="/merchants" className="link">Merchants page</Link>.</> },
              { t: "Check an agent before checkout", b: <>An agent can present a short-lived credential from <span className="code">/api/v1/mandate/credential</span>. Post it to <span className="code">/api/v1/credentials/verify</span>, or verify the signature offline against the gateway&apos;s public key.</> },
              { t: "Settle on the signed record", b: <>Paid orders and refund requests arrive with ledger entries signed by the gateway. Verify them against <span className="code">/.well-known/mandate-gateway.json</span>, or paste a record into the <Link href="/verify" className="link">public verifier</Link>.</> },
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
          <BaselineComparison baseline={agentBaseline} />
          <ResultsMatrix results={agentResults} />
        </section>
      </div>
    </PublicShell>
  );
}
