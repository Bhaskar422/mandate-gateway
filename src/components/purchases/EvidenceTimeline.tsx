import { ledgerEntry, money } from "../format";
import LocalTime from "../LocalTime";

export type EvidenceEntry = { seq: number; type: string; at: string; payload: Record<string, unknown>; prevHash: string; hash: string; signature: string };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);

/** One plain sentence for a ledger entry, taken from its signed payload. */
function summarise(e: EvidenceEntry, currency: string): string | null {
  const p = e.payload;
  switch (e.type) {
    case "purchase.requested": {
      const product = obj(p.productSeenByGateway), merchant = obj(p.merchant), agent = obj(p.agent);
      const seen = num(product.priceCents), said = num(p.agentExpectedPriceCents);
      const what = str(product.name) ?? str(p.productUrl) ?? "a product";
      const price = seen === null ? " The gateway could not read a price from the page." : said !== null && said !== seen
        ? ` The agent said ${money(said, currency)}; the gateway read ${money(seen, currency)} from the store's page.` : ` The gateway read the price from the store's page: ${money(seen, currency)}.`;
      return `${str(agent.name) ?? "An agent"} asked for “${what}”${str(merchant.name) ? ` at ${str(merchant.name)}` : " at a store the gateway does not know"}.${price}`;
    }
    case "purchase.decided": return str(p.reason);
    case "purchase.approved_by_user": return num(p.amountCents) !== null ? `You approved ${money(num(p.amountCents)!, currency)}.` : "You approved this purchase.";
    case "purchase.declined_by_user": return "You declined. Nothing was charged.";
    case "payment.captured": return `${money(num(p.amountCents) ?? 0, str(p.currency) ?? currency)} was paid to ${str(obj(p.merchant).name) ?? "the store"} from your PayPal account. PayPal order ${str(p.paypalOrderId) ?? "unknown"}.`;
    case "payment.failed": return "PayPal did not complete the payment. Nothing was charged.";
    case "problem.reported": return str(p.report) ? `You wrote: “${str(p.report)}”` : null;
    case "refund.requested": return str(obj(p.claim).summary) ?? `A refund was requested from ${str(p.merchant) ?? "the store"}.`;
    case "refund.completed": return `${money(num(p.amountCents) ?? 0, currency)} was refunded${str(p.by) ? ` by ${str(p.by)}` : ""}${p.full === false ? ", and you keep the item" : ""}.${str(p.confirmedBy) ? ` Confirmed by a ${str(p.confirmedBy)}.` : ""}`;
    case "merchant.declined": return str(p.reason);
    case "settlement.offer": {
      const o = obj(p.offer);
      const what = o.type === "full_refund" ? "a full refund" : o.type === "replacement" ? `a replacement${str(o.sku) ? ` (${str(o.sku)})` : ""}` : `a partial refund of ${money(num(o.amountCents) ?? 0, currency)}`;
      return `The store offered ${what}${str(o.reason) ? `: ${str(o.reason)}` : "."}`;
    }
    case "settlement.counter": return num(p.askCents) !== null ? `Your agent asked for ${money(num(p.askCents)!, currency)} instead.` : null;
    case "settlement.accepted": return str(p.replacement) ? `A replacement (${str(p.replacement)}) is on its way${str(p.tracking) ? `, tracking ${str(p.tracking)}` : ""}.` : `Accepted by ${str(p.by) ?? "you"}.`;
    case "settlement.declined": return "You declined the store's offer.";
    case "dispute.opened": return [str(p.event), str(p.reason), str(p.status), str(p.outcome)].filter(Boolean).join(" · ") || null;
    default: return null;
  }
}

/** The signed record of one purchase, oldest first. The plain sentence comes first; hashes are one click away. */
export default function EvidenceTimeline({ entries, currency }: { entries: EvidenceEntry[]; currency: string }) {
  return (
    <ol className="relative">
      {entries.map((e, i) => {
        const meta = ledgerEntry(e.type), summary = summarise(e, currency);
        return (
          <li key={e.seq} className="relative flex gap-4 pb-6 last:pb-0">
            {i < entries.length - 1 && <span className="absolute bottom-0 left-[9px] top-5 w-px bg-line-strong" aria-hidden />}
            <span className={`tone-${meta.tone} relative mt-1 flex size-[19px] shrink-0 items-center justify-center rounded-full border-2 border-[var(--t)] bg-surface`} aria-hidden><span className="tone-fill size-[7px] rounded-full" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h3 className="text-base font-semibold text-ink">{meta.title}</h3>
                <LocalTime iso={e.at} className="num text-xs text-ink-3" />
              </div>
              {summary && <p className="mt-0.5 text-base text-ink-2 [overflow-wrap:anywhere]">{summary}</p>}
              <details className="group mt-1.5">
                <summary className="inline-flex items-center gap-1.5 rounded text-xs text-ink-3 hover:text-ink">
                  <span className="underline decoration-dotted underline-offset-2">Signed entry #{e.seq}</span><span className="code">{e.hash.slice(0, 12)}…</span>
                </summary>
                <div className="mt-2 space-y-2">
                  <pre className="codeblock wrap max-h-80 overflow-y-auto" tabIndex={0}>{JSON.stringify(e.payload, null, 2)}</pre>
                  <dl className="code grid gap-x-3 gap-y-1 text-[11px] text-ink-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                    <dt>type</dt><dd className="break-all">{e.type}</dd>
                    <dt>previous hash</dt><dd className="break-all">{e.prevHash}</dd>
                    <dt>hash</dt><dd className="break-all">{e.hash}</dd>
                    <dt>signature</dt><dd className="break-all">{e.signature}</dd>
                  </dl>
                </div>
              </details>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
