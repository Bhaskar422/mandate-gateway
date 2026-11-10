"use client";
import { BadgeCheck, CircleCheck, CircleDashed, ExternalLink, Plus, Store, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { registerMerchantAction, verifyMerchantAction } from "@/app/actions";
import type { MerchantView } from "@/lib/views";
import { useAccount } from "../AccountProvider";
import type { Tone } from "../format";
import LocalTime from "../LocalTime";
import { Badge } from "../ui/Badge";
import Banner, { ErrorText } from "../ui/Banner";
import Button from "../ui/Button";
import { CodeBlock } from "../ui/Copy";
import { PageHeader, Section } from "../ui/Layout";
import { useAction } from "../useAction";

const TRUST: Record<MerchantView["trust"], { label: string; tone: Tone; icon: React.ReactNode; meaning: string }> = {
  verified: { label: "Verified", tone: "ok", icon: <BadgeCheck size={13} aria-hidden />, meaning: "Checked by the gateway's operator. Mandates that say “verified stores only” or “known merchants” allow these and nothing else." },
  registered: { label: "Registered", tone: "info", icon: <CircleCheck size={13} aria-hidden />, meaning: "The store proved it controls its website, so the gateway knows who it would pay. Allowed only by mandates that name the store or accept any registered store." },
  pending: { label: "Pending", tone: "warn", icon: <CircleDashed size={13} aria-hidden />, meaning: "Someone entered the store's address, but the store has not published its proof yet. It cannot be paid." },
};

/** The file a store publishes to prove it controls its site and to tell the gateway where to pay it. */
const wellKnownFile = (baseUrl: string, token: string) => JSON.stringify({
  mandate_verification: token, name: "Your store's name", paypal: { email: "payments@your-store.example" },
  orders_url: `${baseUrl}/api/orders`, returns_url: `${baseUrl}/api/returns`,
}, null, 2);

/** Step 2 of onboarding: what to publish, where, and the button that checks it. */
function ProveDomain({ merchantId, baseUrl, token, wellKnownUrl, appUrl, onVerified }: { merchantId: string; baseUrl: string; token: string; wellKnownUrl: string; appUrl: string; onVerified: (name: string) => void }) {
  const verify = useAction(verifyMerchantAction);
  const demoSlug = baseUrl.startsWith(`${appUrl}/stores/`) ? baseUrl.slice(`${appUrl}/stores/`.length).split("/")[0] : null;
  return (
    <div className="space-y-4">
      {demoSlug ? (
        <Banner tone="brand" title="This is one of the demo stores">
          Its back office has a field for this. Copy the token below, open <Link href={`/stores/${demoSlug}/admin`} target="_blank" className="link font-semibold">the store&apos;s back office</Link>, paste it under “Gateway verification” and publish. Then come back and check.
        </Banner>
      ) : (
        <p className="text-base text-ink-2">The store&apos;s owner publishes one small JSON file on the store&apos;s own website. Only someone who controls the site can do that, which is the proof.</p>
      )}
      <CodeBlock label="Verification token" code={token} wrap />
      <div>
        <p className="mb-1.5 text-sm text-ink-2">Serve this file at <a href={wellKnownUrl} target="_blank" rel="noreferrer" className="link code break-all">{wellKnownUrl}</a></p>
        <CodeBlock label="mandate-merchant.json" code={wellKnownFile(baseUrl, token)} />
        <p className="field-hint">The token must match exactly. <span className="code">paypal</span> names the account to pay, by <span className="code">email</span> or <span className="code">merchant_id</span>. The two URLs are optional; they must live under the store&apos;s address and are where the gateway sends paid orders and refund requests.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" loading={verify.pending} loadingText="Fetching the file" onClick={async () => { const r = await verify.run(merchantId); if (r) onVerified(r.name); }}>Check the file now</Button>
        {verify.pending && <span className="text-sm text-ink-3" role="status">The gateway is fetching the file from the store.</span>}
      </div>
      {verify.error && <ErrorText>{verify.error}</ErrorText>}
    </div>
  );
}

function Onboard({ onClose }: { onClose: () => void }) {
  const { state } = useAccount();
  const register = useAction(registerMerchantAction);
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<{ merchantId: string; token: string | null; wellKnownUrl: string } | null>(null);
  const [verified, setVerified] = useState<string | null>(null);
  const baseUrl = step?.wellKnownUrl.replace(/\/\.well-known\/mandate-merchant\.json$/, "") ?? "";
  const existing = step ? state.merchants.find((m) => m.id === step.merchantId) : null;

  return (
    <section className="card rise mb-8 border-brand p-5 shadow-card sm:p-6" aria-label="Add a store">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Add a store · Step {step ? 2 : 1} of 2</p>
          <h2 className="display mt-1 text-xl text-ink sm:text-2xl">{verified ? `${verified} can now be paid` : step ? (step.token ? "The store proves it owns the site" : "This store is already in the registry") : "Where is the store?"}</h2>
        </div>
        <button type="button" className="btn btn-quiet btn-sm !px-2" onClick={onClose} aria-label="Close"><X size={16} aria-hidden /></button>
      </div>

      {verified ? (
        <div className="space-y-4">
          <Banner tone="ok" role="status" icon={<CircleCheck size={18} aria-hidden />} title="Domain proved">
            The gateway read the file from the store&apos;s site, matched the token and saved its PayPal payee. It is listed as registered; mandates that accept any registered store, or that name it, can now buy there.
          </Banner>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : !step ? (
        <form onSubmit={async (e) => { e.preventDefault(); const r = await register.run(url); if (r) setStep(r); }}>
          <label htmlFor="store-url" className="field-label">Store address</label>
          <input id="store-url" className="field code max-w-xl" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://shop.example.com" required disabled={register.pending} autoFocus />
          <p className="field-hint">Must be a public https address. Product pages under this address become purchasable once the store has proved it owns the site.</p>
          {!state.merchants.some((m) => m.baseUrl === `${state.appUrl}/stores/peak`) && (
            <p className="mt-3 text-sm text-ink-2">
              Want to try it? The demo store Peak Trail Supply is not in the registry until someone onboards it:{" "}
              <button type="button" className="link code" onClick={() => setUrl(`${state.appUrl}/stores/peak`)}>{state.appUrl}/stores/peak</button>
            </p>
          )}
          <div className="mt-4"><Button type="submit" variant="primary" loading={register.pending} loadingText="Registering" disabled={!url.trim()}>Continue</Button></div>
          {register.error && <div className="mt-3"><ErrorText>{register.error}</ErrorText></div>}
        </form>
      ) : step.token ? (
        <ProveDomain merchantId={step.merchantId} baseUrl={baseUrl} token={step.token} wellKnownUrl={step.wellKnownUrl} appUrl={state.appUrl} onVerified={setVerified} />
      ) : (
        <div className="space-y-4">
          <p className="text-base text-ink-2">
            <span className="font-semibold text-ink">{existing?.name ?? baseUrl}</span> is already listed{existing ? <> as <span className="font-semibold text-ink">{TRUST[existing.trust].label.toLowerCase()}</span></> : ""}, so there is nothing to prove again.
          </p>
          <div className="flex gap-2"><Button onClick={() => { setStep(null); setUrl(""); }}>Add a different store</Button><Button variant="quiet" onClick={onClose}>Close</Button></div>
        </div>
      )}
    </section>
  );
}

function MerchantRow({ m, appUrl }: { m: MerchantView; appUrl: string }) {
  const [open, setOpen] = useState(false);
  const [verified, setVerified] = useState(false);
  const t = TRUST[m.trust];
  return (
    <li className="p-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">{m.name}</p>
          <a href={m.baseUrl} target="_blank" rel="noreferrer" className="code inline-flex items-start gap-1 text-ink-3 hover:text-ink [overflow-wrap:anywhere]">{m.baseUrl}<ExternalLink size={11} className="mt-1 shrink-0" aria-hidden /></a>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={t.tone} icon={t.icon}>{t.label}</Badge>
          <Badge tone={m.payable ? "neutral" : "bad"}>{m.payable ? "Can be paid" : "Cannot be paid"}</Badge>
        </div>
      </div>
      <p className="mt-1.5 text-sm text-ink-3">
        {m.source === "builtin" ? "Demo store that ships with this gateway." : m.domainVerifiedAt ? <>Onboarded by URL; proved its domain <LocalTime iso={m.domainVerifiedAt} format="date" />.</> : "Onboarded by URL; waiting for the store to publish its proof."}
        {!m.payable && m.trust !== "pending" && " No PayPal payee is on file for it."}
      </p>
      {m.trust === "pending" && m.verificationToken && m.wellKnownUrl && !verified && (
        <div className="mt-3">
          {!open ? <Button size="sm" onClick={() => setOpen(true)}>Finish verifying</Button> : (
            <div className="rise rounded-[10px] border border-line bg-raised p-4">
              <ProveDomain merchantId={m.id} baseUrl={m.baseUrl} token={m.verificationToken} wellKnownUrl={m.wellKnownUrl} appUrl={appUrl} onVerified={() => setVerified(true)} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** The registry of stores the gateway can pay, what each trust level means, and onboarding a new store by URL. */
export default function Merchants() {
  const { state } = useAccount();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader title="Merchants" lead="The gateway decides who gets paid from this registry, never from what an agent says. A store that is not listed here cannot be paid at all."
        actions={!adding && <Button variant="primary" icon={<Plus size={15} aria-hidden />} onClick={() => setAdding(true)}>Add a store</Button>} />

      {adding && <Onboard onClose={() => setAdding(false)} />}

      <section aria-label="Trust levels" className="mb-8 grid gap-3 md:grid-cols-3">
        {(Object.keys(TRUST) as MerchantView["trust"][]).map((k) => (
          <div key={k} className="card p-4">
            <Badge tone={TRUST[k].tone} icon={TRUST[k].icon}>{TRUST[k].label}</Badge>
            <p className="mt-2 text-sm text-ink-2">{TRUST[k].meaning}</p>
          </div>
        ))}
      </section>

      <Section title="Registry" hint={`${state.merchants.length} stores. The registry is shared by everyone using this gateway.`}>
        {state.merchants.length === 0
          ? <div className="card flex items-center gap-3 p-4 text-ink-2"><Store size={18} aria-hidden />No stores are registered yet.</div>
          : <ul className="card divide-y divide-line">{state.merchants.map((m) => <MerchantRow key={m.id} m={m} appUrl={state.appUrl} />)}</ul>}
      </Section>
    </>
  );
}
