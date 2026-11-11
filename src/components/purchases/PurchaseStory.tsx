import { Bot, Landmark, ShieldCheck, Store, User } from "lucide-react";
import { checkFailed, money, plural, type Tone } from "../format";
import LocalTime from "../LocalTime";
import type { EvidenceEntry } from "./EvidenceTimeline";

type Actor = "buyer" | "agent" | "gateway" | "store" | "paypal";
export type Stage = { actor: Actor; label: string; fact: string | null; at: string | null; tone: Tone };
export type Story = { stages: Stage[]; ending: "open" | "done" | "stopped"; waiting: Stage | null };

const ACTOR: Record<Actor, { name: string; icon: React.ReactNode }> = {
  buyer: { name: "You", icon: <User size={17} aria-hidden /> },
  agent: { name: "Agent", icon: <Bot size={17} aria-hidden /> },
  gateway: { name: "Gateway", icon: <ShieldCheck size={17} aria-hidden /> },
  store: { name: "Store", icon: <Store size={17} aria-hidden /> },
  paypal: { name: "PayPal", icon: <Landmark size={17} aria-hidden /> },
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);
const sentence = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).replace(/_/g, " ");

function offerFact(offer: unknown, currency: string) {
  const o = obj(offer);
  if (o.type === "full_refund") return "A full refund";
  if (o.type === "replacement") return `A replacement${str(o.sku) ? ` (${str(o.sku)})` : ""}`;
  return num(o.amountCents) !== null ? `${money(num(o.amountCents)!, currency)} back, and you keep the item` : "A partial refund";
}

/** The stages one ledger entry stands for. Most entries are one stage; a decision that did not simply allow the purchase is two. */
function stagesOf(e: EvidenceEntry, currency: string): Omit<Stage, "at">[] {
  const p = e.payload;
  const cents = (v: unknown) => (num(v) !== null ? money(num(v)!, str(p.currency) ?? currency) : null);
  switch (e.type) {
    case "purchase.requested":
      return [{ actor: "agent", label: "Asked to buy", fact: str(obj(p.productSeenByGateway).name) ?? "A page the gateway could not read", tone: "neutral" }];
    case "purchase.decided": {
      const checks = Array.isArray(p.checks) ? (p.checks as { rule?: string; passed?: boolean }[]) : [];
      const passed = checks.filter((c) => c.passed).length, failed = checks.find((c) => !c.passed);
      const tally = checks.length === 0 ? null : passed === checks.length ? `All ${plural(passed, "check")} passed` : `${passed} of ${plural(checks.length, "check")} passed`;
      const why = failed?.rule ? checkFailed(failed.rule) : str(p.reason);
      if (p.outcome === "block") return [{ actor: "gateway", label: "Checked your rules", fact: tally, tone: "brand" }, { actor: "gateway", label: "Blocked", fact: why, tone: "bad" }];
      if (p.outcome === "needs_approval") return [{ actor: "gateway", label: "Checked your rules", fact: tally, tone: "brand" }, { actor: "gateway", label: "Held it for you", fact: why, tone: "warn" }];
      return [{ actor: "gateway", label: "Checked and allowed", fact: tally, tone: "brand" }];
    }
    case "purchase.approved_by_user": return [{ actor: "buyer", label: "Approved", fact: cents(p.amountCents), tone: "ok" }];
    case "purchase.declined_by_user": return [{ actor: "buyer", label: "Declined", fact: "Nothing was charged", tone: "neutral" }];
    case "payment.authorized": return [{ actor: "paypal", label: "Reserved the money", fact: cents(p.amountCents) ? `${cents(p.amountCents)}, not charged yet` : "Not charged yet", tone: "info" }];
    case "payment.captured":
      if (p.chargedOnShipment) return [
        { actor: "store", label: "Shipped", fact: str(p.tracking) ? `Tracking ${str(p.tracking)}` : "The store reported the shipment", tone: "neutral" },
        { actor: "paypal", label: "Charged you", fact: cents(p.amountCents), tone: "ok" },
      ];
      return [{ actor: "paypal", label: "Paid the store", fact: cents(p.amountCents), tone: "ok" }];
    case "payment.voided": {
      const why = str(p.at) ?? "";
      return [{ actor: "store", label: "Released the reservation", fact: `${why.startsWith("automatically") ? "Not shipped in time" : why.includes("buyer") ? "You cancelled" : "Cancelled"}. Nothing was charged`, tone: "neutral" }];
    }
    case "payment.failed": return [{ actor: "paypal", label: "Payment failed", fact: "Nothing was charged", tone: "bad" }];
    case "problem.reported": return [{ actor: "buyer", label: "Reported a problem", fact: str(p.report) ? `“${str(p.report)}”` : null, tone: "warn" }];
    case "refund.requested": return [{ actor: "gateway", label: "Asked the store for a refund", fact: str(obj(p.claim).issue) ? `Reason: ${sentence(str(obj(p.claim).issue)!).toLowerCase()}` : "With the signed record", tone: "info" }];
    case "refund.completed": {
      const amount = `${cents(p.amountCents) ?? "The money"}${p.full === false ? ", and you keep the item" : ""}`;
      return [str(p.confirmedBy) ? { actor: "paypal", label: "Confirmed a refund", fact: amount, tone: "info" } : { actor: "store", label: "Refunded", fact: amount, tone: "info" }];
    }
    case "merchant.declined": return [{ actor: "store", label: "Declined", fact: str(p.reason), tone: "bad" }];
    case "settlement.offer": return [{ actor: "store", label: "Made an offer", fact: offerFact(p.offer, currency), tone: "warn" }];
    case "settlement.counter": return [{ actor: "agent", label: "Asked for more", fact: cents(p.askCents), tone: "neutral" }];
    case "settlement.accepted":
      if (str(p.replacement)) return [{ actor: "store", label: "Sent a replacement", fact: str(p.tracking) ? `Tracking ${str(p.tracking)}` : str(p.replacement), tone: "info" }];
      return str(p.by) === "the user"
        ? [{ actor: "buyer", label: "Accepted the offer", fact: offerFact(p.offer, currency), tone: "info" }]
        : [{ actor: "agent", label: "Accepted the offer", fact: "Inside your settlement rules", tone: "info" }];
    case "settlement.declined": return [{ actor: "buyer", label: "Declined the offer", fact: offerFact(p.offer, currency), tone: "neutral" }];
    case "dispute.opened": {
      const event = str(p.event) ?? "", outcome = str(p.outcome);
      if (event.endsWith("RESOLVED")) return [{ actor: "paypal", label: "Decided the dispute", fact: !outcome ? "Closed" : outcome.includes("BUYER") ? "In your favour" : "In the store's favour", tone: "dispute" }];
      if (event.endsWith("CREATED")) return [{ actor: "paypal", label: "Opened a dispute", fact: str(p.reason) ? sentence(str(p.reason)!) : null, tone: "dispute" }];
      return [{ actor: "paypal", label: "Updated the dispute", fact: str(p.status) ? sentence(str(p.status)!) : null, tone: "dispute" }];
    }
    case "dispute.evidence_submitted": return [{ actor: "store", label: "Took the signed record", fact: "To answer the PayPal dispute", tone: "dispute" }];
    default: return [];
  }
}

/** What the purchase is waiting on now, if anything. Only an open purchase has a next stage. */
function waitingOn(status: string, caseStatus: string | null): Omit<Stage, "at"> | null {
  if (caseStatus === "offer_pending") return { actor: "buyer", label: "Waiting for your answer", fact: "Accept or decline the offer", tone: "warn" };
  if (status === "pending_approval") return { actor: "buyer", label: "Waiting for you", fact: "Approve or decline", tone: "warn" };
  if (status === "authorized") return { actor: "store", label: "Waiting for the store to ship", fact: "You are charged when it ships", tone: "info" };
  if (status === "paying") return { actor: "paypal", label: "Paying", fact: null, tone: "neutral" };
  if (status === "refund_requested") return { actor: "store", label: "Waiting for the store", fact: "It has been asked for a refund", tone: "info" };
  if (status === "disputed") return { actor: "paypal", label: "Waiting for PayPal", fact: "The dispute is not decided", tone: "dispute" };
  return null;
}

const STOPPED = ["blocked", "declined", "payment_failed", "cancelled"];

/** Turn the signed entries of one purchase into the stages a person would tell it in. */
export function buildStory(entries: EvidenceEntry[], status: string, caseStatus: string | null, currency: string): Story {
  const stages = entries.flatMap((e) => stagesOf(e, currency).map((s) => ({ ...s, at: e.at })));
  const next = waitingOn(status, caseStatus);
  return { stages, waiting: next ? { ...next, at: null } : null, ending: next ? "open" : STOPPED.includes(status) ? "stopped" : "done" };
}

/** The first stage carries the date. After that a stage shows only the time, unless a day has turned or hours have passed since the one before. */
const sameSitting = (a: string | null, b: string | null) => !!a && !!b && a.slice(0, 10) === b.slice(0, 10) && Math.abs(new Date(b).getTime() - new Date(a).getTime()) < 6 * 3600e3;

function StageItem({ s, state, link, timeOnly }: { s: Stage; state: "past" | "current" | "ended" | "waiting"; link: "solid" | "dashed" | "none"; timeOnly: boolean }) {
  const a = ACTOR[s.actor];
  const node = state === "past" ? "tone-softbg tone-text"
    : state === "waiting" ? "border-2 border-dashed border-[var(--t)] bg-surface tone-text motion-safe:animate-pulse"
      : "tone-fill text-surface ring-4 ring-[var(--t-soft)]";
  const focus = state !== "past";
  return (
    <li className={`tone-${s.tone} relative flex gap-3 pb-5 last:pb-0 sm:block sm:pb-0`} aria-current={focus ? "step" : undefined}>
      <div className="relative shrink-0 sm:flex sm:h-9 sm:items-center">
        <span className={`relative z-10 flex size-9 items-center justify-center rounded-full ${node}`}>{a.icon}</span>
        {link !== "none" && (
          <span aria-hidden className={`absolute -bottom-5 left-[17px] top-9 border-l border-line-strong sm:bottom-auto sm:left-9 sm:right-0 sm:top-1/2 sm:border-l-0 sm:border-t ${link === "dashed" ? "border-dashed" : ""}`} />
        )}
        {state === "ended" && (
          <span aria-hidden className="absolute left-9 top-1/2 hidden items-center sm:flex"><span className="w-6 border-t border-line-strong" /><span className="tone-fill h-4 w-[3px] rounded-full" /></span>
        )}
      </div>
      <div className={`min-w-0 flex-1 sm:mr-4 sm:mt-3 ${focus ? "tone-softbg -mt-1 rounded-[10px] p-3 sm:mt-3" : "pt-0.5 sm:pt-0"}`}>
        <p className={`eyebrow ${focus ? "!text-[color:var(--t-ink)]" : ""}`}>{a.name}</p>
        <p className={`mt-0.5 text-base font-semibold leading-snug ${focus ? "tone-text" : "text-ink"}`}>{s.label}</p>
        {s.fact && <p className={`num mt-0.5 line-clamp-3 text-sm [overflow-wrap:anywhere] ${focus ? "tone-text" : "text-ink-2"}`} title={s.fact}>{s.fact}</p>}
        {s.at
          ? <LocalTime iso={s.at} format={timeOnly ? "time" : "datetime"} className={`num mt-1 block text-xs ${focus ? "tone-text" : "text-ink-3"}`} />
          : <p className="tone-text mt-1 text-xs font-semibold">Now</p>}
        {state === "ended" && <p className="tone-text mt-1 text-xs font-semibold">It ended here</p>}
      </div>
    </li>
  );
}

/**
 * One purchase as a sequence of stages, each naming who acted: you, the agent, the gateway, the store or PayPal.
 * It runs left to right on a wide screen and top to bottom on a phone. Every stage comes from a signed ledger entry;
 * the only one that does not is the dashed last stage of an open purchase, which says what it is waiting on.
 */
export default function PurchaseStory({ entries, status, caseStatus, currency }: { entries: EvidenceEntry[]; status: string; caseStatus: string | null; currency: string }) {
  const { stages, ending, waiting } = buildStory(entries, status, caseStatus, currency);
  if (stages.length === 0) return null;
  const last = stages.length - 1;
  const where = ending === "open" ? "In progress" : ending === "stopped" ? `Ended at step ${stages.length}` : "Finished";
  return (
    <section aria-label="What happened, step by step" className="card mb-5 p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="eyebrow">What happened, step by step</p>
        <p className="flex items-center gap-1.5 text-sm text-ink-3">
          {ending === "open" && <span className="tone-warn tone-fill inline-block size-1.5 rounded-full motion-safe:animate-pulse" aria-hidden />}
          {plural(stages.length, "step")} · {where}
        </p>
      </div>
      <ol className="sm:grid sm:grid-cols-[repeat(auto-fit,minmax(9.25rem,1fr))] sm:gap-y-7">
        {stages.map((s, i) => (
          <StageItem key={i} s={s} timeOnly={i > 0 && sameSitting(stages[i - 1].at, s.at)} state={i < last || waiting ? "past" : ending === "stopped" ? "ended" : "current"}
            link={i < last ? "solid" : waiting ? "dashed" : "none"} />
        ))}
        {waiting && <StageItem s={waiting} state="waiting" link="none" timeOnly />}
      </ol>
    </section>
  );
}
