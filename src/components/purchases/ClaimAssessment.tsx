"use client";
import { ArrowRight, Scale } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { assessClaimAction, reportProblemAction } from "@/app/actions";
import type { Assessment, ClaimKind } from "@/lib/assess";
import type { PurchaseView } from "@/lib/views";
import Banner, { ErrorText } from "../ui/Banner";
import Button from "../ui/Button";
import { useAction } from "../useAction";

// Kept in step with CLAIMS in src/lib/assess.ts, which is server code and cannot be imported here.
const KINDS: { kind: ClaimKind; label: string; report: string }[] = [
  { kind: "not_received", label: "It never arrived", report: "The item has not arrived." },
  { kind: "wrong_item", label: "The wrong item arrived", report: "The wrong item arrived: it is not what was ordered." },
  { kind: "damaged", label: "It arrived damaged or not as described", report: "The item arrived damaged or not as described." },
  { kind: "unauthorised", label: "I did not authorise this purchase", report: "I did not authorise this purchase." },
];
const FAVOURS = {
  buyer: { tone: "ok" as const, label: "The records support you" },
  store: { tone: "warn" as const, label: "The records support the store" },
  unclear: { tone: "neutral" as const, label: "The records cannot settle this" },
};

/**
 * Before a complaint becomes a dispute: pick what went wrong, and see the gateway's signed record lined up against
 * the store's own order book, with where that leaves you. Nothing is sent to the store and no money moves until
 * the buyer chooses what to do next.
 */
export default function ClaimAssessment({ p }: { p: PurchaseView }) {
  const assess = useAction(assessClaimAction), report = useAction(reportProblemAction);
  const [a, setA] = useState<Assessment | null>(null);
  const [kind, setKind] = useState<ClaimKind | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (p.status !== "captured") return null;
  const store = p.merchant ?? "the store";
  const pick = async (k: ClaimKind) => { setKind(k); setA(null); const r = await assess.run(p.id, k); if (r) setA(r.assessment); };
  const send = async () => { const r = await report.run(p.id, KINDS.find((x) => x.kind === kind)!.report); if (r) setDone(r.message); };

  if (done) return <Banner tone="info" role="status" title="Here is what happened">{done}</Banner>;
  return (
    <section aria-label="Check a complaint against both records" className="card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink"><Scale size={17} aria-hidden /></span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">Something wrong with this order?</h2>
          <p className="text-base text-ink-2">Say what happened. The gateway compares its signed record with {store}&apos;s own order book and shows you where you stand, before anything is sent or disputed.</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="What went wrong">
        {KINDS.map((k) => (
          <button key={k.kind} type="button" aria-pressed={kind === k.kind} disabled={assess.pending || report.pending} onClick={() => pick(k.kind)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-55 ${kind === k.kind ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:border-line-strong hover:text-ink"}`}>{k.label}</button>
        ))}
      </div>
      {assess.pending && <p className="mt-3 text-sm text-ink-3" role="status">Asking {store} for its record of this order.</p>}
      <ErrorText>{assess.error}</ErrorText>

      {a && (
        <div className="rise mt-5" role="status">
          <div className={`tone-${FAVOURS[a.favours].tone} rounded-[10px] border border-line p-4`}>
            <p className="tone-text text-xs font-bold uppercase tracking-wider">{FAVOURS[a.favours].label}</p>
            <p className="mt-1 text-lg font-semibold text-ink">{a.headline}</p>
            <p className="mt-1 text-base text-ink-2 [overflow-wrap:anywhere]">{a.why}</p>
          </div>

          <dl className="mt-4 divide-y divide-line rounded-[10px] border border-line">
            {a.facts.map((f) => (
              <div key={f.what} className="px-4 py-3">
                <dt className="font-semibold text-ink">{f.what}</dt>
                <dd className="mt-1.5 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                  <div className="min-w-0"><p className="eyebrow">Gateway&apos;s signed record</p><p className="text-ink-2 [overflow-wrap:anywhere]">{f.gateway}</p></div>
                  <div className="min-w-0"><p className="eyebrow">{store}&apos;s order book</p><p className={`[overflow-wrap:anywhere] ${f.agree === false ? "font-semibold text-bad-ink" : "text-ink-2"}`}>{f.store}</p></div>
                </dd>
              </div>
            ))}
          </dl>
          {!a.storeAnswered && <p className="mt-2 text-sm text-ink-3">This store does not publish a statement of its orders, so only the gateway&apos;s side is shown.</p>}

          <div className="mt-4 space-y-2">
            {a.next.map((n, i) => (
              <div key={n.action} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[10px] border border-line bg-raised px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{n.label}</p>
                  <p className="text-sm text-ink-2">{n.detail}</p>
                </div>
                {(n.action === "refund" || n.action === "settle") && <Button variant={i === 0 ? "primary" : "secondary"} size="sm" loading={report.pending} icon={<ArrowRight size={14} aria-hidden />} onClick={send}>{n.action === "refund" ? "Ask for the refund" : "Ask the store"}</Button>}
                {n.action === "secure" && <Link href="/agents" className="btn btn-secondary btn-sm">Review agents</Link>}
              </div>
            ))}
          </div>
          <ErrorText>{report.error}</ErrorText>
          <p className="mt-3 text-sm text-ink-3">This comparison is now part of the purchase&apos;s signed record.</p>
        </div>
      )}
    </section>
  );
}
