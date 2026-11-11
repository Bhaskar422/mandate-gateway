"use client";
import { ArrowLeft, BadgeCheck, Download, ExternalLink, FileText, ShieldX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useAccount } from "../AccountProvider";
import { money } from "../format";
import LocalTime from "../LocalTime";
import { StatusBadge } from "../ui/Badge";
import Banner from "../ui/Banner";
import { CopyButton } from "../ui/Copy";
import { Fact, Section } from "../ui/Layout";
import ChecksList from "./ChecksList";
import DecisionReveal from "./DecisionReveal";
import EvidenceTimeline, { type EvidenceEntry } from "./EvidenceTimeline";
import InjectionWarning from "./InjectionWarning";
import NegotiationThread from "./NegotiationThread";
import { ApprovalButtons, CancelHold, OfferCard, ReconcileWithPayPal, ReportProblem } from "./PurchaseActions";
import { purchaseReason } from "./PurchaseCard";
import PurchaseStory from "./PurchaseStory";

export type Verification = { ok: true } | { ok: false; why: string };
type Basics = { id: string; productName: string | null; productUrl: string; amountCents: number; currency: string; status: string; createdAt: string };

/** Everything about one purchase: the decision, the signed record behind it, and what happened afterwards. */
export default function PurchaseDetail({ basics, entries, verification }: { basics: Basics; entries: EvidenceEntry[]; verification: Verification }) {
  const { state } = useAccount();
  const router = useRouter();
  const p = state.purchases.find((x) => x.id === basics.id) ?? null;

  // The ledger entries come from the server render. When the live state shows the purchase moved on, fetch them again.
  const stamp = p ? `${p.status}|${p.case?.status ?? ""}|${p.case?.transcript.length ?? 0}|${p.refundedCents}` : "";
  const seen = useRef(stamp);
  useEffect(() => { if (stamp !== seen.current) { seen.current = stamp; router.refresh(); } }, [stamp, router]);

  const status = p?.status ?? basics.status, currency = p?.currency ?? basics.currency, amount = p?.amountCents ?? basics.amountCents;
  const title = p?.productName ?? basics.productName ?? "Unreadable product page";

  return (
    <>
      <Link href="/activity" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"><ArrowLeft size={14} aria-hidden />Activity</Link>

      <header className="card mb-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <p className="eyebrow">Purchase record</p>
            <h1 className="display mt-1 text-2xl text-ink [overflow-wrap:anywhere] sm:text-3xl">{title}{p && p.quantity > 1 && <span className="text-ink-3"> × {p.quantity}</span>}</h1>
          </div>
          {amount > 0 && <p className="display num text-2xl text-ink sm:text-3xl">{money(amount, currency)}</p>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={status} />
          {p?.case && !["refunded", "refund_requested", "open"].includes(p.case.status) && <StatusBadge status={p.case.status} kind="case" />}
        </div>
        {p && <p className="mt-3 max-w-3xl text-lg text-ink [overflow-wrap:anywhere]">{purchaseReason(p)}</p>}
        <p className="mt-2 text-sm text-ink-3 [overflow-wrap:anywhere]">
          {p ? <>{p.merchant ?? "Unknown store"} · by {p.agent ?? "an agent"}{p.mandateName ? ` · under “${p.mandateName}”` : ""} · </> : null}<LocalTime iso={p?.createdAt ?? basics.createdAt} />
        </p>

        {p && (
          <div className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
            <figure>
              <figcaption className="eyebrow">What you asked the agent for</figcaption>
              <blockquote className="quote mt-1 italic [overflow-wrap:anywhere]">“{p.userRequest}”</blockquote>
            </figure>
            {p.agentReason && (
              <figure>
                <figcaption className="eyebrow">Why the agent picked this</figcaption>
                <blockquote className="quote mt-1 italic [overflow-wrap:anywhere]">“{p.agentReason}”</blockquote>
              </figure>
            )}
          </div>
        )}

        {p && (p.status === "pending_approval" || p.status === "captured" || p.status === "authorized" || p.case?.status === "offer_pending") && (
          <div className="mt-5 space-y-3 border-t border-line pt-5">
            {p.status === "pending_approval" && <>
              <p className="text-base text-ink-2">This purchase is waiting for you. Approving pays the store from your PayPal account right away; your mandate&apos;s limits are checked again first.</p>
              <ApprovalButtons p={p} />
            </>}
            <CancelHold p={p} />
            {p.case?.status === "offer_pending" && <OfferCard p={p} />}
            <ReportProblem p={p} />
          </div>
        )}
      </header>

      <PurchaseStory entries={entries} status={status} caseStatus={p?.case?.status ?? null} currency={currency} />

      {p && p.signals.length > 0 && <div className="mb-5"><InjectionWarning signals={p.signals} /></div>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {p?.case && (
            <Section title="Settlement" hint={`Your agent and ${p.merchant ?? "the store"}'s agent worked this out on the signed record.`}>
              <div className="card p-4 sm:p-5">
                <figure className="mb-4 border-b border-line pb-4">
                  <figcaption className="eyebrow">Your report</figcaption>
                  <blockquote className="quote mt-1 italic [overflow-wrap:anywhere]">“{p.case.report}”</blockquote>
                </figure>
                <NegotiationThread transcript={p.case.transcript} merchant={p.merchant} />
                {p.case.status === "merchant_declined" && p.paypalCaptureId && (
                  <Banner tone="neutral" className="mt-4" title="You can still dispute this with PayPal">
                    Open a dispute in PayPal&apos;s Resolution Center for transaction <span className="code">{p.paypalCaptureId}</span> and attach the signed record from this page.
                  </Banner>
                )}
              </div>
            </Section>
          )}

          <Section title="Signed evidence record" hint="Every step, written to a tamper-evident ledger as it happened.">
            <div className="card p-4 sm:p-5">
              {entries.length === 0 ? <p className="text-base text-ink-3">There are no ledger entries for this purchase.</p> : <EvidenceTimeline entries={entries} currency={currency} />}
            </div>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Verification">
            <div className="card p-4 sm:p-5">
              {verification.ok ? (
                <Banner tone="ok" icon={<BadgeCheck size={18} aria-hidden />} title="This record is authentic">
                  All {entries.length} entries carry the gateway&apos;s signature, and the whole ledger chain is intact: nothing was edited, removed or reordered.
                </Banner>
              ) : (
                <Banner tone="bad" role="alert" icon={<ShieldX size={18} aria-hidden />} title="Verification failed">{verification.why}</Banner>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <a className="btn btn-secondary btn-sm" href={`/api/purchases/${basics.id}/evidence`} download><Download size={13} aria-hidden />Signed record (JSON)</a>
                <a className="btn btn-secondary btn-sm" href={`/api/purchases/${basics.id}/evidence.pdf`}><FileText size={13} aria-hidden />Evidence PDF</a>
              </div>
              <p className="mt-3 text-sm text-ink-3">Anyone you send the JSON file to can check it on the public <Link href="/verify" className="link">verify page</Link>, without an account.</p>
            </div>
          </Section>

          {p && (
            <Section title="Policy checks" hint="What the gateway checked, in order, before deciding.">
              <div className="card p-4 sm:p-5">
                <div className="mb-4 border-b border-line pb-4">
                  <DecisionReveal checks={p.checks} outcome={p.outcome} status={p.status} reason={p.reason} reserved={entries.some((e) => e.type === "payment.authorized")} />
                </div>
                <ChecksList checks={p.checks} />
              </div>
            </Section>
          )}

          <Section title="Details">
            <dl className="card grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-1 xl:grid-cols-2">
              <Fact label="Purchase id"><span className="code">{basics.id}</span></Fact>
              {p?.sku && <Fact label="SKU"><span className="code">{p.sku}</span></Fact>}
              {p && p.refundedCents > 0 && <Fact label="Refunded"><span className="num">{money(p.refundedCents, currency)} of {money(amount, currency)}</span></Fact>}
              {p?.paypalOrderId && <Fact label="PayPal order"><span className="code">{p.paypalOrderId}</span></Fact>}
              {p?.paypalCaptureId && <Fact label="PayPal transaction"><span className="code">{p.paypalCaptureId}</span></Fact>}
              <div className="sm:col-span-2 lg:col-span-1 xl:col-span-2">
                <Fact label="Product page">
                  <a href={p?.productUrl ?? basics.productUrl} target="_blank" rel="noreferrer" className="link code inline-flex items-start gap-1">{p?.productUrl ?? basics.productUrl}<ExternalLink size={12} className="mt-1 shrink-0" aria-hidden /></a>
                </Fact>
              </div>
              {p?.approvalUrl && (
                <div className="sm:col-span-2 lg:col-span-1 xl:col-span-2">
                  <Fact label="Approval link">
                    <span className="flex flex-wrap items-center gap-2"><span className="code min-w-0 break-all">{p.approvalUrl}</span><CopyButton text={p.approvalUrl} /></span>
                    <span className="mt-1 block text-xs text-ink-3">Opens a one-page approval on any device, no sign-in. The agent is given this link to pass to you.</span>
                  </Fact>
                </div>
              )}
            </dl>
          </Section>
        </div>
      </div>

      {p?.paypalOrderId && (
        <Section title="PayPal's own record" className="mt-6" hint="The ledger is the gateway's account of what happened. PayPal keeps its own. This asks PayPal for the order and compares the two, fact by fact.">
          <div className="card p-4 sm:p-5"><ReconcileWithPayPal purchaseId={basics.id} /></div>
        </Section>
      )}
    </>
  );
}
