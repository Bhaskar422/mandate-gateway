"use client";
import { ArrowRight, Ban, CircleCheck, CircleDashed, Clock, RotateCcw, Scale, ShieldAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { PurchaseView } from "@/lib/views";
import { describeOffer, money, purchaseStatus, type Tone } from "../format";
import LocalTime from "../LocalTime";
import { Badge, StatusBadge } from "../ui/Badge";
import { ApprovalButtons, OfferCard, ReportProblem } from "./PurchaseActions";

const ICON: Record<Tone, React.ReactNode> = {
  ok: <CircleCheck size={18} aria-hidden />, warn: <Clock size={18} aria-hidden />, bad: <Ban size={18} aria-hidden />, info: <RotateCcw size={18} aria-hidden />,
  dispute: <Scale size={18} aria-hidden />, flag: <ShieldAlert size={18} aria-hidden />, brand: <CircleDashed size={18} aria-hidden />, neutral: <CircleDashed size={18} aria-hidden />,
};

/** What the gateway (or the store) last said about this purchase, in one sentence. */
export function purchaseReason(p: PurchaseView) {
  if (p.case?.status === "merchant_declined" && p.case.merchantReason) return `The store declined a refund: ${p.case.merchantReason}`;
  if (p.case?.status === "offer_pending" && p.case.pendingOffer) return `${p.merchant ?? "The store"} offered ${describeOffer(p.case.pendingOffer, p.amountCents, p.currency)} instead of a full refund. It is waiting for your answer.`;
  if (p.case?.status === "settled" && p.status === "captured" && p.case.transcript.length) return `Settled with the store: ${p.case.transcript[p.case.transcript.length - 1].note}.`;
  if (p.status === "refunded") return `${money(p.refundedCents, p.currency)} was refunded to your PayPal account.`;
  if (p.status === "partially_refunded") return `${money(p.refundedCents, p.currency)} of ${money(p.amountCents, p.currency)} was refunded under an agreed settlement.`;
  if (p.status === "refund_requested") return "The store is being asked for a refund.";
  if (p.status === "declined") return "You declined this purchase. Nothing was charged.";
  if (p.status === "payment_failed") return "It was approved, but PayPal did not complete the payment. Nothing was charged.";
  return p.reason;
}

/**
 * One purchase attempt: what, how much, where, by which agent, under which mandate, why it was decided the
 * way it was, and the one action that fits its state. `compact` drops the actions for short lists.
 */
export default function PurchaseCard({ p, compact = false }: { p: PurchaseView; compact?: boolean }) {
  const s = purchaseStatus(p.status);
  const title = p.productName ?? "Unreadable product page";
  return (
    <article className="card p-4 sm:p-5">
      <div className="flex gap-3.5">
        <span className={`tone-${s.tone} tone-softbg tone-text mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full`}>{ICON[s.tone]}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <h3 className="min-w-0 text-lg font-semibold text-ink [overflow-wrap:anywhere]">
              <Link href={`/purchases/${p.id}`} className="hover:underline">{title}</Link>
              {p.quantity > 1 && <span className="font-normal text-ink-3"> × {p.quantity}</span>}
            </h3>
            {p.amountCents > 0 && (
              <p className="num text-lg font-semibold text-ink">
                {p.status === "blocked" || p.status === "declined" || p.status === "payment_failed" ? <span className="text-ink-3 line-through decoration-1">{money(p.amountCents, p.currency)}</span> : money(p.amountCents, p.currency)}
              </p>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={p.status} />
            {p.case?.status === "offer_pending" && <StatusBadge status="offer_pending" kind="case" />}
            {p.case?.status === "merchant_declined" && <StatusBadge status="merchant_declined" kind="case" />}
            {p.injectionFlag && <Badge tone="flag" icon={<TriangleAlert size={12} aria-hidden />}>Injection attempt on page</Badge>}
          </div>
          <p className="mt-2 text-base text-ink-2 [overflow-wrap:anywhere]">{purchaseReason(p)}</p>
          <p className="mt-2 text-sm text-ink-3 [overflow-wrap:anywhere]">
            {p.merchant ?? "Unknown store"} · by {p.agent ?? "an agent"}{p.mandateName ? ` · under “${p.mandateName}”` : p.mandateId ? " · under your mandate" : ""} · <LocalTime iso={p.createdAt} format="relative" />
          </p>

          {!compact && (
            <div className="mt-3 space-y-3">
              {p.status === "pending_approval" && <ApprovalButtons p={p} size="sm" />}
              {p.case?.status === "offer_pending" && <OfferCard p={p} />}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Link href={`/purchases/${p.id}`} className="btn btn-quiet btn-sm -ml-2">View record<ArrowRight size={13} aria-hidden /></Link>
                <ReportProblem p={p} />
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
