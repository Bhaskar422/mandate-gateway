"use client";
import { CircleCheck, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { registerMerchantAction, verifyMerchantAction } from "@/app/actions";
import type { MerchantInsights } from "@/lib/merchant-insights";
import type { MerchantView } from "@/lib/views";
import { plural } from "../format";
import { Badge } from "../ui/Badge";
import Banner, { ErrorText } from "../ui/Banner";
import Button from "../ui/Button";
import { CodeBlock } from "../ui/Copy";
import { useAction } from "../useAction";
import Insights from "./Insights";
import { TRUST, TRUST_ORDER } from "./trust";

/** The file a store publishes to prove it owns its site and to tell the gateway where to pay it. */
const wellKnownFile = (baseUrl: string, token: string) => JSON.stringify({
  mandate_verification: token, name: "Your store's name", paypal: { email: "payments@your-store.example" },
  orders_url: `${baseUrl}/api/orders`, returns_url: `${baseUrl}/api/returns`,
}, null, 2);

/** Step 2: what to publish, where, and the button that makes the gateway read it. */
function ProveOwnership({ merchantId, baseUrl, token, wellKnownUrl, appUrl, onProved }: { merchantId: string; baseUrl: string; token: string; wellKnownUrl: string; appUrl: string; onProved: (name: string) => void }) {
  const check = useAction(verifyMerchantAction);
  const demoSlug = baseUrl.startsWith(`${appUrl}/stores/`) ? baseUrl.slice(`${appUrl}/stores/`.length).split("/")[0] : null;
  return (
    <div className="space-y-4">
      {demoSlug ? (
        <Banner tone="brand" title="This is one of the demo stores">
          Its back office has a field for this. Copy the token below, open <Link href={`/stores/${demoSlug}/admin`} target="_blank" className="link font-semibold">the store&apos;s back office</Link>, paste it under “Gateway verification” and publish. Then come back and check.
        </Banner>
      ) : (
        <p className="text-base text-ink-2">Publish one small JSON file on your store&apos;s own website. Only someone who controls the site can do that, which is the proof.</p>
      )}
      <CodeBlock label="Ownership token" code={token} wrap />
      <div>
        <p className="mb-1.5 text-sm text-ink-2">Serve this file at <a href={wellKnownUrl} target="_blank" rel="noreferrer" className="link code break-all">{wellKnownUrl}</a></p>
        <CodeBlock label="mandate-merchant.json" code={wellKnownFile(baseUrl, token)} />
        <p className="field-hint">The token must match exactly. <span className="code">paypal</span> names the account to pay, by <span className="code">email</span> or <span className="code">merchant_id</span>. The two URLs are optional; they must live under your store&apos;s address and are where the gateway sends paid orders and refund requests.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" loading={check.pending} loadingText="Reading the file" onClick={async () => { const r = await check.run(merchantId); if (r) onProved(r.name); }}>Check the file now</Button>
        {check.pending && <span className="text-sm text-ink-3" role="status">The gateway is fetching the file from your site.</span>}
      </div>
      {check.error && <ErrorText>{check.error}</ErrorText>}
    </div>
  );
}

function MyStore({ m, insights, appUrl, onChange }: { m: MerchantView; insights?: MerchantInsights; appUrl: string; onChange: () => void }) {
  const t = TRUST[m.trust];
  return (
    <li className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">{m.name}</p>
          <a href={m.baseUrl} target="_blank" rel="noreferrer" className="code inline-flex items-start gap-1 text-ink-3 hover:text-ink [overflow-wrap:anywhere]">{m.baseUrl}<ExternalLink size={11} className="mt-1 shrink-0" aria-hidden /></a>
        </div>
        <Badge tone={t.tone} icon={t.icon}>{t.label}</Badge>
      </div>
      {m.claiming && m.verificationToken && m.wellKnownUrl ? (
        <div className="mt-4 border-t border-line pt-4">
          <p className="eyebrow mb-2">Manage this store from this browser</p>
          <p className="mb-3 text-base text-ink-2">This store was registered from another browser. Replace the token in its published file with the one below and check the file. This browser then becomes the one that manages the store and sees its agent sales. Nothing else about the store changes.</p>
          <ProveOwnership merchantId={m.id} baseUrl={m.baseUrl} token={m.verificationToken} wellKnownUrl={m.wellKnownUrl} appUrl={appUrl} onProved={onChange} />
        </div>
      ) : m.trust === "pending" && m.verificationToken && m.wellKnownUrl ? (
        <div className="mt-4 border-t border-line pt-4">
          <p className="eyebrow mb-2">Step 2 of 2 · Prove you own the site</p>
          <ProveOwnership merchantId={m.id} baseUrl={m.baseUrl} token={m.verificationToken} wellKnownUrl={m.wellKnownUrl} appUrl={appUrl} onProved={onChange} />
        </div>
      ) : m.trust === "registered" ? (
        <p className="mt-3 text-base text-ink-2">
          Your store is registered{m.payable ? " and can be paid" : ", but no PayPal payee is on file, so it cannot be paid yet"}. Agents can buy here for users whose mandates name your store or accept any registered store.
          Verified status is a separate decision made by the gateway&apos;s operator after a review; there is nothing more for you to publish.
        </p>
      ) : (
        <p className="mt-3 text-base text-ink-2">Your store is verified. Mandates that say “known merchants only” allow it.</p>
      )}
      {insights && m.trust !== "pending" && (
        <details className="mt-4 border-t border-line pt-4">
          <summary className="link cursor-pointer text-base font-semibold">
            Agent sales: {insights.requests.total === 0 ? "no agent requests yet" : `${plural(insights.requests.total, "agent request")}, ${plural(insights.requests.paid, "paid order")}, ${insights.requests.blocked} blocked`}
          </summary>
          <div className="mt-4"><Insights insights={insights} /></div>
        </details>
      )}
    </li>
  );
}

/** Where a store joins the gateway. Separate from the shopper's dashboard: a merchant needs no PayPal link or mandate here. */
export default function MerchantPortal({ merchants, insights = {}, appUrl }: { merchants: MerchantView[]; insights?: Record<string, MerchantInsights>; appUrl: string }) {
  const router = useRouter();
  const register = useAction(registerMerchantAction);
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState<{ kind: "exists" | "proved"; text: string } | null>(null);
  const mine = merchants.filter((m) => m.registeredByMe || m.claiming);
  const peakListed = merchants.some((m) => m.baseUrl === `${appUrl}/stores/peak`);

  return (
    <>
      <header className="mb-8 max-w-3xl">
        <p className="eyebrow">For merchants</p>
        <h1 className="display mt-1 text-3xl text-ink">Let shopping agents pay your store</h1>
        <p className="mt-2 text-lg text-ink-2">
          Shopping agents pay your store from the shopper&apos;s PayPal account, and only inside rules the shopper set. You receive a signed record of every order, and you can answer refund requests and PayPal disputes with that record.
          To be paid, your store tells the gateway who it is. That takes two steps and no account.
        </p>
      </header>

      <section aria-label="Standing with the gateway" className="mb-10">
        <ol className="grid gap-3 md:grid-cols-3">
          {TRUST_ORDER.map((k, i) => (
            <li key={k} className="card p-4">
              <p className="eyebrow mb-2">{i === 0 ? "Start" : i === 1 ? "After step 2" : "After review"}</p>
              <Badge tone={TRUST[k].tone} icon={TRUST[k].icon}>{TRUST[k].label}</Badge>
              <p className="mt-2 text-sm text-ink-2">{TRUST[k].meaning}</p>
              <p className="mt-2 text-sm text-ink-3"><span className="font-semibold text-ink-2">How:</span> {TRUST[k].how}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Register a store" className="card mb-10 p-5 sm:p-6">
        <p className="eyebrow">Step 1 of 2</p>
        <h2 className="display mt-1 text-xl text-ink sm:text-2xl">Where is your store?</h2>
        <form className="mt-4" onSubmit={async (e) => {
          e.preventDefault(); setNotice(null);
          const r = await register.run(url);
          if (!r) return;
          if (r.claiming) setNotice({ kind: "exists", text: "That store is already registered. If it is yours, prove it from this browser: its card below has a token for you to publish." });
          else if (!r.token) setNotice({ kind: "exists", text: "That store is already in the registry and managed from this browser, so there is nothing to register again." });
          setUrl(""); router.refresh();
        }}>
          <label htmlFor="store-url" className="field-label">Store address</label>
          <input id="store-url" className="field code max-w-xl" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://shop.example.com" required disabled={register.pending} />
          <p className="field-hint">A public https address. Product pages under it become purchasable once you have proved you own the site.</p>
          {!peakListed && (
            <p className="mt-3 text-sm text-ink-2">
              Want to try it? The demo store Peak Trail Supply is not in the registry until someone registers it:{" "}
              <button type="button" className="link code" onClick={() => setUrl(`${appUrl}/stores/peak`)}>{appUrl}/stores/peak</button>
            </p>
          )}
          <div className="mt-4"><Button type="submit" variant="primary" loading={register.pending} loadingText="Registering" disabled={!url.trim()}>Register this address</Button></div>
          {register.error && <div className="mt-3"><ErrorText>{register.error}</ErrorText></div>}
          {notice?.kind === "exists" && <p className="mt-3 text-sm text-ink-2" role="status">{notice.text}</p>}
        </form>
      </section>

      <section aria-label="Stores registered from this browser">
        <h2 className="mb-1 text-lg font-semibold text-ink">Stores managed from this browser</h2>
        <p className="mb-3 text-sm text-ink-3">A store&apos;s token and its agent sales are shown only in the browser that proved it owns the site. On a new browser, register the same address again: you get a fresh token, and publishing it moves the store to that browser.</p>
        {notice?.kind === "proved" && (
          <Banner tone="ok" role="status" className="mb-3" icon={<CircleCheck size={18} aria-hidden />} title="Ownership proved">{notice.text}</Banner>
        )}
        {mine.length === 0
          ? <p className="card p-4 text-base text-ink-2">None yet. Register an address above to get your ownership token.</p>
          : <ul className="space-y-3">{mine.map((m) => <MyStore key={m.id} m={m} insights={insights[m.id]} appUrl={appUrl} onChange={() => { setNotice({ kind: "proved", text: "The gateway read the file from your site, matched the token and saved your PayPal payee. Your store is now registered." }); router.refresh(); }} />)}</ul>}
      </section>
    </>
  );
}
