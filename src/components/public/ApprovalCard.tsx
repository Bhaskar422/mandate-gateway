"use client";
import { BadgeCheck, Ban, Bot, Check, CircleCheck, CircleX, Hand, Link2Off, ShieldAlert, Store, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { approveByTokenAction } from "@/app/actions";
import type { PageSignal } from "@/lib/risk";
import { money } from "../format";
import InjectionWarning from "../purchases/InjectionWarning";
import { ErrorText } from "../ui/Banner";
import Button from "../ui/Button";
import { useAction } from "../useAction";

export type ApprovalRequest = {
  token: string; productName: string; amountCents: number; currency: string; quantity: number; merchant: string | null; merchantVerified: boolean;
  agent: string | null; userRequest: string; agentReason: string | null; reason: string; signals: PageSignal[];
  /** The buyer chose to be charged on shipment, so approving may reserve the money instead of paying. */
  reserve: boolean;
};

type Outcome = { tone: "ok" | "info" | "bad" | "neutral"; icon: React.ReactNode; title: string; body: (r: ApprovalRequest) => string };
const OUTCOME: Record<string, Outcome> = {
  captured: { tone: "ok", icon: <CircleCheck size={30} aria-hidden />, title: "Approved and paid", body: (r) => `${money(r.amountCents, r.currency)} was paid to ${r.merchant ?? "the store"} from your PayPal account. Your agent can see that it went through.` },
  authorized: { tone: "info", icon: <CircleCheck size={30} aria-hidden />, title: "Approved and reserved", body: (r) => `${money(r.amountCents, r.currency)} is reserved on your PayPal account for ${r.merchant ?? "the store"}. You are charged when the store ships.` },
  declined: { tone: "neutral", icon: <CircleX size={30} aria-hidden />, title: "Declined", body: () => "Nothing was charged. Your agent will see that you said no." },
  blocked: { tone: "bad", icon: <Ban size={30} aria-hidden />, title: "Approved, but it could not be paid", body: () => "Your mandate no longer allows this purchase: the budget ran out, the mandate ended, or spending is frozen. Nothing was charged." },
  payment_failed: { tone: "bad", icon: <CircleX size={30} aria-hidden />, title: "PayPal did not complete the payment", body: () => "You approved it, but PayPal declined the payment. Nothing was charged." },
};

/** A final state: one mark, one sentence, nothing left to press. */
function Final({ tone, icon, title, children, receipt }: { tone: string; icon: React.ReactNode; title: string; children: React.ReactNode; receipt?: React.ReactNode }) {
  return (
    <article className={`tone-${tone} card rise overflow-hidden text-center shadow-card`} role="status">
      <div className="px-5 pb-6 pt-8 sm:px-8">
        <span className="tone-softbg tone-text mx-auto flex size-16 items-center justify-center rounded-full">{icon}</span>
        <h1 className="display mt-4 text-2xl text-ink">{title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-lg text-ink-2 [overflow-wrap:anywhere]">{children}</p>
      </div>
      {receipt}
      <div className="border-t border-line px-5 py-4 sm:px-8">
        <p className="text-base font-semibold text-ink">You can close this page.</p>
        <p className="mt-1 text-sm text-ink-3">The full record is in <Link href="/activity" className="link">your dashboard</Link>.</p>
      </div>
    </article>
  );
}

/** The one-page approval a user reaches from the link their agent hands them. The link itself is the credential. */
export default function ApprovalCard({ request }: { request: ApprovalRequest | null }) {
  const decide = useAction(approveByTokenAction);
  // Answering uses the link up, and the page re-renders without the request. Keep the first copy so the outcome can still be shown.
  const [r] = useState(request);
  const [choice, setChoice] = useState<boolean | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const go = async (approve: boolean) => { if (!r) return; setChoice(approve); const res = await decide.run(r.token, approve); if (res) setStatus(res.status); };

  if (!r) {
    return (
      <Final tone="neutral" icon={<Link2Off size={28} aria-hidden />} title="This link is no longer valid">
        The purchase was already answered, or it is no longer waiting. Each link works once. If your agent is still waiting, ask it to check the purchase.
      </Final>
    );
  }

  const price = money(r.amountCents, r.currency);
  const aimed = r.signals.filter((x) => x.kind === "agent_directed_text"), hidden = r.signals.some((x) => x.kind === "hidden_text");
  if (status) {
    const o = OUTCOME[status] ?? { tone: "neutral" as const, icon: <CircleCheck size={30} aria-hidden />, title: "Your answer was recorded", body: () => `This purchase is now ${status.replace(/_/g, " ")}.` };
    return (
      <Final tone={o.tone} icon={o.icon} title={o.title} receipt={
        <div className="mx-5 mb-6 rounded-[10px] border border-line bg-raised px-4 py-3 text-left sm:mx-8">
          <p className="flex items-baseline justify-between gap-4 text-base font-semibold">
            <span className="min-w-0 text-ink [overflow-wrap:anywhere]">{r.productName}{r.quantity > 1 && <span className="font-normal text-ink-3"> × {r.quantity}</span>}</span>
            <span className={`num shrink-0 ${status === "captured" || status === "authorized" ? "text-ink" : "text-ink-3 line-through decoration-1"}`}>{price}</span>
          </p>
          <p className="mt-0.5 text-sm text-ink-3 [overflow-wrap:anywhere]">{r.merchant ?? "Unknown store"} · asked by {r.agent ?? "your agent"}</p>
        </div>
      }>{o.body(r)}</Final>
    );
  }

  return (
    <article className="card shadow-card">
      {/* The decision: what, how much, where, who asked, and why it came to you. */}
      <div className="px-4 pt-4 sm:px-6 sm:pt-6">
        <p className="eyebrow">Approval needed</p>
        <h1 className="display mt-1 text-xl leading-snug text-ink [overflow-wrap:anywhere] sm:text-2xl">{r.productName}{r.quantity > 1 && <span className="text-ink-3"> × {r.quantity}</span>}</h1>
        <p className="display num mt-1 text-[2.5rem] leading-[1.15] text-ink">{price}</p>
        <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-lg">
          <div className="flex items-start gap-2.5">
            <Store size={17} className="mt-1 shrink-0 text-ink-3" aria-hidden />
            <dt className="sr-only">Store</dt>
            <dd className="min-w-0 flex-1 text-ink [overflow-wrap:anywhere]">
              {r.merchant ?? "An unknown store"}
              {r.merchant && (r.merchantVerified
                ? <span className="tone-ok tone-text ml-2 inline-flex items-center gap-1 whitespace-nowrap align-baseline text-sm font-semibold"><BadgeCheck size={14} aria-hidden />Verified store</span>
                : <span className="tone-warn tone-text ml-2 whitespace-nowrap text-sm font-semibold">Not verified</span>)}
            </dd>
          </div>
          <div className="flex items-start gap-2.5">
            <Bot size={17} className="mt-1 shrink-0 text-ink-3" aria-hidden />
            <dt className="sr-only">Agent</dt>
            <dd className="min-w-0 flex-1 text-ink [overflow-wrap:anywhere]"><span className="text-ink-2">Asked by</span> {r.agent ?? "your agent"}</dd>
          </div>
        </dl>
      </div>

      <div className="space-y-3 px-4 py-4 sm:px-6">
        {/* The short form of the warning sits on the first screen; the full text the page carried is further down. */}
        {aimed.length > 0 && (
          <section aria-label="Warning about the store's page" className="tone-flag tone-softbg rounded-[10px] p-3.5">
            <h2 className="tone-text flex items-start gap-2 text-base font-semibold"><ShieldAlert size={17} className="tone-mark mt-0.5 shrink-0" aria-hidden />The store&apos;s page has text written for AI agents{hidden ? ", hidden from shoppers" : ""}</h2>
            <blockquote className="mt-2 rounded-lg bg-surface px-3 py-2"><p className="code line-clamp-3 text-ink [overflow-wrap:anywhere]">…{aimed[0].excerpt}…</p></blockquote>
            <a href="#page-text" className="tone-text mt-2 inline-block text-sm font-semibold underline underline-offset-2">Read what the page said</a>
          </section>
        )}

        <section aria-label="Why you are being asked" className="tone-warn tone-softbg rounded-[10px] p-3.5">
          <h2 className="tone-text flex items-center gap-2 text-sm font-semibold"><Hand size={15} className="tone-mark shrink-0" aria-hidden />Why you are being asked</h2>
          <p className="mt-1 text-lg text-ink [overflow-wrap:anywhere]">{r.reason}</p>
        </section>

        <section aria-label="The request" className="grid gap-4 pt-2">
          <figure>
            <figcaption className="eyebrow">What you asked the agent for</figcaption>
            <blockquote className="quote mt-1 italic [overflow-wrap:anywhere]">“{r.userRequest}”</blockquote>
          </figure>
          {r.agentReason && (
            <figure>
              <figcaption className="eyebrow">Why the agent picked this</figcaption>
              <blockquote className="quote mt-1 italic [overflow-wrap:anywhere]">“{r.agentReason}”</blockquote>
            </figure>
          )}
          {aimed.length > 0 && <div id="page-text" className="scroll-mt-3"><InjectionWarning signals={r.signals} /></div>}
          <p className="text-sm text-ink-3">
            The gateway read the product and price from the store&apos;s own page. It did not take them from the agent.{" "}
            {r.reserve ? "You chose to be charged on shipment: approving reserves the money now where the store allows it, and pays now where it does not." : "Approving pays the store from your PayPal account now."}
          </p>
        </section>
      </div>

      {/* On a phone the two answers stay under the thumb; on a wider screen they close the card. */}
      <div className="border-t border-line bg-surface px-4 pt-3 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-20 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:shadow-card sm:sticky sm:bottom-0 sm:rounded-b-[12px] sm:px-6 sm:pb-4 sm:pt-4">
        {decide.error && <div className="mb-2"><ErrorText>{decide.error}</ErrorText></div>}
        <div className="mx-auto grid max-w-[520px] grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] gap-2.5">
          <Button size="lg" className="!min-h-[3.25rem] !text-lg" icon={<X size={18} aria-hidden />} loading={decide.pending && choice === false} loadingText="Declining" disabled={decide.pending} onClick={() => go(false)}>Decline</Button>
          <Button variant="primary" size="lg" className="!min-h-[3.25rem] !whitespace-normal !text-lg !leading-tight" icon={<Check size={18} className="shrink-0" aria-hidden />} loading={decide.pending && choice === true} loadingText={r.reserve ? "Asking PayPal" : "Paying with PayPal"} disabled={decide.pending} onClick={() => go(true)}>
            <span>{r.reserve ? "Approve" : "Approve and pay"} <span className="num whitespace-nowrap">{price}</span></span>
          </Button>
        </div>
      </div>
    </article>
  );
}
