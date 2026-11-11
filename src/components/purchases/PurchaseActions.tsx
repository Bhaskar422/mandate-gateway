"use client";
import { Check, CircleHelp, Handshake, MessageSquareWarning, X } from "lucide-react";
import { useState } from "react";
import { answerOfferAction, approvalAction, cancelHoldAction, reconcilePurchaseAction, reportProblemAction } from "@/app/actions";
import type { PurchaseView } from "@/lib/views";
import { useAccount } from "../AccountProvider";
import { describeOffer, money } from "../format";
import Banner, { ErrorText } from "../ui/Banner";
import Button from "../ui/Button";
import ConfirmButton from "../ui/ConfirmButton";
import { useAction } from "../useAction";

/** Approve or decline a purchase that is waiting for the user. */
export function ApprovalButtons({ p, size = "md" }: { p: PurchaseView; size?: "sm" | "md" }) {
  const { run, pending, error } = useAction(approvalAction);
  const [choice, setChoice] = useState<boolean | null>(null);
  const go = (approve: boolean) => { setChoice(approve); run(p.id, approve); };
  // With "charge on shipment" on, approving may only reserve the money, so the button does not promise a charge.
  const reserve = useAccount().state.account.settings.chargeOnShipment;
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size={size} icon={<Check size={15} aria-hidden />} loading={pending && choice === true} loadingText={reserve ? "Asking PayPal" : "Paying with PayPal"} disabled={pending} onClick={() => go(true)}>
          {reserve ? "Approve" : "Approve and pay"} {p.amountCents > 0 && money(p.amountCents, p.currency)}
        </Button>
        <Button size={size} icon={<X size={15} aria-hidden />} loading={pending && choice === false} disabled={pending} onClick={() => go(false)}>Decline</Button>
      </div>
      {error && <div className="mt-2"><ErrorText>{error}</ErrorText></div>}
    </div>
  );
}

/** The store's offer that fell outside the user's automatic settlement rules. */
export function OfferCard({ p }: { p: PurchaseView }) {
  const { run, pending, error } = useAction(answerOfferAction);
  const [choice, setChoice] = useState<boolean | null>(null);
  const c = p.case;
  if (!c?.pendingOffer) return null;
  const o = c.pendingOffer;
  const go = (accept: boolean) => { setChoice(accept); run(c.id, accept); };
  return (
    <div className="tone-warn rounded-[10px] border border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-warn-soft p-4">
      <p className="flex items-center gap-2 font-semibold text-warn-ink"><Handshake size={17} className="tone-mark shrink-0" aria-hidden />{p.merchant ?? "The store"} offered {describeOffer(o, p.amountCents, p.currency)}</p>
      <p className="mt-1 text-sm text-warn-ink [overflow-wrap:anywhere]">{o.reason} This is below what you told the gateway to accept automatically, so it is your call.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" loading={pending && choice === true} loadingText="Accepting" disabled={pending} onClick={() => go(true)}>
          Accept {o.type === "partial_refund" && o.amountCents ? money(o.amountCents, p.currency) : o.type === "replacement" ? "replacement" : "refund"}
        </Button>
        <Button size="sm" loading={pending && choice === false} loadingText="Declining" disabled={pending} onClick={() => go(false)}>Decline offer</Button>
      </div>
      <p className="mt-2 text-xs text-warn-ink">If you decline, the case closes with the store and you can still open a dispute with PayPal using the signed record.</p>
      {error && <div className="mt-2"><ErrorText>{error}</ErrorText></div>}
    </div>
  );
}

/** Report a problem once; the buyer's agent then negotiates with the store on the signed record. */
export function ReportProblem({ p }: { p: PurchaseView }) {
  const { run, pending, error } = useAction(reportProblemAction);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  if (result) return <Banner tone="info" role="status" icon={<CircleHelp size={17} aria-hidden />} title="Here is what happened">{result}</Banner>;
  if (p.status !== "captured") return null;
  if (!open) return <Button size="sm" icon={<MessageSquareWarning size={14} aria-hidden />} onClick={() => setOpen(true)}>Report a problem</Button>;
  const id = `problem-${p.id}`;
  return (
    <form className="rise w-full rounded-[10px] border border-line bg-raised p-4" onSubmit={async (e) => { e.preventDefault(); const r = await run(p.id, text.trim()); if (r && r.status !== "offer_pending") setResult(r.message); }}>
      <label htmlFor={id} className="field-label">What went wrong?</label>
      <textarea id={id} className="field" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: I ordered the Tempo 3 but received a pair of socks." required minLength={5} maxLength={1000} disabled={pending} autoFocus />
      <p className="field-hint">Say it once, in your own words. The gateway sends the store the signed record of what you ordered and asks for a refund on your behalf.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" loading={pending} loadingText="Talking to the store" disabled={text.trim().length < 5}>Send to the store</Button>
        <Button size="sm" variant="quiet" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
        {pending && <span className="text-xs text-ink-3" role="status">This can take up to a minute while the two agents negotiate.</span>}
      </div>
      {error && <div className="mt-2"><ErrorText>{error}</ErrorText></div>}
    </form>
  );
}


/** A reserved purchase can be cancelled until the store ships it. */
export function CancelHold({ p }: { p: PurchaseView }) {
  const { run, pending, error } = useAction(cancelHoldAction);
  const { state } = useAccount();
  if (p.status !== "authorized") return null;
  return (
    <div className="space-y-2">
      <p className="text-base text-ink-2">The money is reserved at PayPal but has not been charged. It is charged when {p.merchant ?? "the store"} ships. Until then you can cancel and nothing is taken. If it has not shipped after {state.account.settings.holdReleaseDays} days, the reservation is released automatically.</p>
      <ConfirmButton variant="secondary" question="Cancel this purchase and release the money?" confirmLabel="Cancel purchase" loading={pending} onConfirm={() => run(p.id)}>Cancel before it ships</ConfirmButton>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Ask PayPal about the order and line its answer up against the gateway's own record. */
export function ReconcileWithPayPal({ purchaseId }: { purchaseId: string }) {
  const { run, pending, error } = useAction(reconcilePurchaseAction);
  const [r, setR] = useState<{ rows: { what: string; gateway: string; paypal: string; match: boolean }[]; allMatch: boolean; note?: string } | null>(null);
  return (
    <div>
      <Button size="sm" loading={pending} loadingText="Asking PayPal" onClick={async () => { const x = await run(purchaseId); if (x) setR(x); }}>Check against PayPal</Button>
      <ErrorText>{error}</ErrorText>
      {r && (r.note ? <p className="mt-2 text-sm text-ink-2">{r.note}</p> : (
        <div className="mt-3" role="status">
          <p className={`text-sm font-semibold ${r.allMatch ? "text-ok-ink" : "text-bad-ink"}`}>{r.allMatch ? "PayPal's record of this order matches the gateway's." : "PayPal's record differs from the gateway's. The rows marked below do not match."}</p>
          <div className="mt-2 overflow-x-auto rounded-[10px] border border-line">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="bg-raised text-left text-ink-3"><th className="px-3 py-2 font-semibold">Fact</th><th className="px-3 py-2 font-semibold">Gateway ledger</th><th className="px-3 py-2 font-semibold">PayPal</th><th className="px-3 py-2 font-semibold">Match</th></tr></thead>
              <tbody>
                {r.rows.map((x) => (
                  <tr key={x.what} className="border-t border-line">
                    <td className="px-3 py-2 text-ink">{x.what}</td>
                    <td className="code px-3 py-2 text-ink-2 [overflow-wrap:anywhere]">{x.gateway}</td>
                    <td className="code px-3 py-2 text-ink-2 [overflow-wrap:anywhere]">{x.paypal}</td>
                    <td className={`px-3 py-2 font-semibold ${x.match ? "text-ok-ink" : "text-bad-ink"}`}>{x.match ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
