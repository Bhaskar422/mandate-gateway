"use client";
import { ExternalLink, Store } from "lucide-react";
import Link from "next/link";
import type { MerchantView } from "@/lib/views";
import { useAccount } from "../AccountProvider";
import LocalTime from "../LocalTime";
import { Badge } from "../ui/Badge";
import { PageHeader, Section } from "../ui/Layout";
import { TRUST, TRUST_ORDER } from "./trust";

function MerchantRow({ m, allowedBy }: { m: MerchantView; allowedBy: string[] }) {
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
        {!m.payable ? "Your agents cannot buy here."
          : allowedBy.length ? <>Your agents can buy here under: <span className="text-ink-2">{allowedBy.join(", ")}</span>.</>
          : "None of your mandates allows this store, so purchases here are blocked."}
        {m.source === "onboarded" && m.domainVerifiedAt && <> Joined <LocalTime iso={m.domainVerifiedAt} format="date" />.</>}
      </p>
    </li>
  );
}

/** The stores this gateway can pay, and which of them the user's own mandates allow. Stores join in the merchant portal, not here. */
export default function Merchants() {
  const { state } = useAccount();
  const allowedBy = (m: MerchantView) => state.mandates.filter((x) => {
    const r = x.rules;
    if ((r.blockedMerchants ?? []).some((b) => b.toLowerCase() === m.name.toLowerCase())) return false;
    return r.merchantPolicy === "any_registered" ? m.trust !== "pending" : r.merchantPolicy === "verified_only" ? m.trust === "verified" : r.allowedMerchants.some((a) => a.toLowerCase() === m.name.toLowerCase());
  }).map((x) => x.name ?? "Untitled mandate");

  return (
    <>
      <PageHeader title="Merchants" lead="The stores this gateway can pay. Who gets paid is decided from this list, never from what an agent says, and your mandates decide which of these stores your agents may use."
        actions={<Link href="/for-merchants" className="btn btn-secondary">Run a store? Merchant portal</Link>} />

      <section aria-label="What the labels mean" className="mb-8 grid gap-3 md:grid-cols-3">
        {TRUST_ORDER.map((k) => (
          <div key={k} className="card p-4">
            <Badge tone={TRUST[k].tone} icon={TRUST[k].icon}>{TRUST[k].label}</Badge>
            <p className="mt-2 text-sm text-ink-2">{TRUST[k].meaning}</p>
          </div>
        ))}
      </section>

      <Section title="Stores" hint={`${state.merchants.length} stores. The list is shared by everyone using this gateway; you choose among them in your mandates.`}>
        {state.merchants.length === 0
          ? <div className="card flex items-center gap-3 p-4 text-ink-2"><Store size={18} aria-hidden />No stores have joined yet.</div>
          : <ul className="card divide-y divide-line">{state.merchants.map((m) => <MerchantRow key={m.id} m={m} allowedBy={allowedBy(m)} />)}</ul>}
      </Section>
    </>
  );
}
