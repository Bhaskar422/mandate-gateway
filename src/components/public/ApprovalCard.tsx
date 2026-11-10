"use client";
import { Ban, Check, CircleCheck, CircleX, Link2Off, X } from "lucide-react";
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
};

const OUTCOME: Record<string, { tone: "ok" | "bad" | "neutral"; icon: React.ReactNode; title: string; body: (r: ApprovalRequest) => string }> = {
  captured: { tone: "ok", icon: <CircleCheck size={22} aria-hidden />, title: "Approved and paid", body: (r) => `${money(r.amountCents, r.currency)} was paid to ${r.merchant ?? "the store"} from your PayPal account. Your agent can see that it went through.` },
  declined: { tone: "neutral", icon: <CircleX size={22} aria-hidden />, title: "Declined", body: () => "Nothing was charged. Your agent will see that you said no." },
  blocked: { tone: "bad", icon: <Ban size={22} aria-hidden />, title: "Approved, but it could not be paid", body: () => "Your mandate no longer allows this purchase: the budget ran out, the mandate ended, or spending is frozen. Nothing was charged." },
  payment_failed: { tone: "bad", icon: <CircleX size={22} aria-hidden />, title: "PayPal did not complete the payment", body: () => "You approved it, but PayPal declined the payment. Nothing was charged." },
};

/** The one-page approval a user reaches from the link their agent hands them. The link itself is the credential. */
export default function ApprovalCard({ request }: { request: ApprovalRequest | null }) {
  const decide = useAction(approveByTokenAction);
  // Answering uses the link up, and the page re-renders without the request. Keep the first copy so the outcome can still be shown.
  const [r] = useState(request);
  const [choice, setChoice] = useState<boolean | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const go = async (approve: boolean) => { if (!r) return; setChoice(approve); const res = await decide.run(r.token, approve); if (res) setStatus(res.status); };
  const outcome = status ? OUTCOME[status] ?? { tone: "neutral" as const, icon: <CircleCheck size={22} aria-hidden />, title: "Done", body: () => `This purchase is now ${status.replace(/_/g, " ")}.` } : null;

  if (!r) {
    return (
      <div className="card p-6 text-center sm:p-8">
        <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-sunken text-ink-3"><Link2Off size={20} aria-hidden /></span>
        <h1 className="display mt-3 text-2xl text-ink">This approval link is no longer valid</h1>
        <p className="mt-2 text-base text-ink-2">It has already been answered, or the purchase is no longer waiting. Each link works once. If your agent is still waiting, ask it to check the purchase status.</p>
        <Link href="/activity" className="btn btn-secondary mt-5">Open your dashboard</Link>
      </div>
    );
  }

  return (
    <article className="card shadow-card">
      <div className="rounded-t-[12px] border-b border-line bg-raised px-5 py-4 sm:px-6">
        <p className="eyebrow">{outcome ? "Your answer was recorded" : "Your agent is asking to buy"}</p>
        <h1 className="display mt-1 text-2xl text-ink [overflow-wrap:anywhere]">{r.productName}{r.quantity > 1 && <span className="text-ink-3"> × {r.quantity}</span>}</h1>
        <p className="display num mt-1 text-3xl text-ink">{money(r.amountCents, r.currency)}</p>
        <p className="mt-1 text-sm text-ink-3">from {r.merchant ?? "an unknown store"}{r.merchantVerified ? " (verified store)" : ""} · asked by {r.agent ?? "your agent"}</p>
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-6">
        {outcome ? (
          <div className={`tone-${outcome.tone} rise rounded-[10px] bg-[var(--t-soft)] p-5 text-center`} role="status">
            <span className="tone-mark inline-flex">{outcome.icon}</span>
            <p className="display mt-1 text-xl text-ink">{outcome.title}</p>
            <p className="mx-auto mt-1 max-w-sm text-base text-ink-2">{outcome.body(r)}</p>
            <p className="mt-3 text-sm text-ink-3">You can close this page.</p>
          </div>
        ) : (
          <>
            <section aria-label="Why you are being asked">
              <h2 className="eyebrow">Why you are being asked</h2>
              <p className="mt-1 text-base text-ink [overflow-wrap:anywhere]">{r.reason}</p>
            </section>

            <InjectionWarning signals={r.signals} compact />

            <section aria-label="The request" className="grid gap-4">
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
            </section>

            <p className="text-sm text-ink-3">The product and price above were read by the gateway from the store&apos;s own page, not taken from the agent. Approving pays the store from your PayPal account now.</p>

            <div className="sticky bottom-0 -mx-5 -mb-5 rounded-b-[12px] border-t border-line bg-surface px-5 py-4 sm:-mx-6 sm:px-6">
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="primary" size="lg" icon={<Check size={17} aria-hidden />} loading={decide.pending && choice === true} loadingText="Paying with PayPal" disabled={decide.pending} onClick={() => go(true)}>Approve and pay {money(r.amountCents, r.currency)}</Button>
                <Button size="lg" icon={<X size={17} aria-hidden />} loading={decide.pending && choice === false} loadingText="Declining" disabled={decide.pending} onClick={() => go(false)}>Decline</Button>
              </div>
              {decide.error && <div className="mt-2"><ErrorText>{decide.error}</ErrorText></div>}
            </div>
          </>
        )}
      </div>
    </article>
  );
}
