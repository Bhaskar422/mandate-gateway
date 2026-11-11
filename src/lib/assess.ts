// Before a complaint becomes a PayPal dispute, line up what the gateway's signed record says against what the
// store's own order book says, and tell the buyer where they stand. Most disputes are decided by exactly these
// facts, so most can be settled here, by the two records, without waiting weeks for a ruling.
// This reads and compares. It moves no money and changes no purchase; what happens next is the buyer's choice.
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { money } from "./ids";
import { append } from "./ledger";

export type ClaimKind = "not_received" | "wrong_item" | "damaged" | "unauthorised";
export const CLAIMS: { kind: ClaimKind; label: string; report: string }[] = [
  { kind: "not_received", label: "It never arrived", report: "The item has not arrived." },
  { kind: "wrong_item", label: "The wrong item arrived", report: "The wrong item arrived: it is not what was ordered." },
  { kind: "damaged", label: "It arrived damaged or not as described", report: "The item arrived damaged or not as described." },
  { kind: "unauthorised", label: "I did not authorise this purchase", report: "I did not authorise this purchase." },
];

/** What a store says about one order, from its own records. Stores answer this at <orders_url>/statement. */
export type StoreStatement = { status: "paid" | "held" | "shipped" | "refunded" | "cancelled"; orderedSku: string; shippedSku: string | null; tracking: string | null; replacementSent: boolean };

export type Fact = { what: string; gateway: string; store: string; agree: boolean | null };
export type Assessment = {
  claim: ClaimKind;
  /** Whose account the two records support. "unclear" means the records cannot show it either way. */
  favours: "buyer" | "store" | "unclear";
  headline: string;
  why: string;
  facts: Fact[];
  /** What the buyer can do from here, most sensible first. */
  next: { action: "refund" | "settle" | "wait" | "secure" | "paypal"; label: string; detail: string }[];
  storeAnswered: boolean;
  assessedAt: string;
};

type Order = { sku: string | null; name: string; amountCents: number; currency: string; merchant: string; paidAt: string | null; mandateName: string | null; agentName: string | null; approvedByUser: boolean; chargedOnShipment: boolean };

/** The comparison itself: pure, so it can be tested without a database or a store. */
export function compare(claim: ClaimKind, o: Order, s: StoreStatement | null, now = new Date()): Assessment {
  const amount = money(o.amountCents, o.currency);
  const shipped = s ? s.status === "shipped" || (s.status === "refunded" && !!s.shippedSku) : null;
  const facts: Fact[] = [
    { what: "What was ordered", gateway: `${o.name}${o.sku ? ` (${o.sku})` : ""}`, store: s ? s.orderedSku : "no answer", agree: s ? (o.sku ? s.orderedSku === o.sku : null) : null },
    { what: "Amount paid", gateway: amount, store: s ? "matches the signed payment record it was sent" : "no answer", agree: s ? true : null },
    { what: "Shipped", gateway: o.chargedOnShipment ? "yes: the store reported shipping, and only then were you charged" : "the gateway does not see shipments for this order", store: s ? (shipped ? `yes${s.tracking ? `, tracking ${s.tracking}` : ""}` : "not yet") : "no answer", agree: null },
    { what: "What was shipped", gateway: "not recorded by the gateway", store: s ? (s.shippedSku ?? "nothing yet") : "no answer", agree: s && s.shippedSku ? s.shippedSku === s.orderedSku : null },
  ];
  const base = { claim, facts, storeAnswered: !!s, assessedAt: now.toISOString() };
  const paypal = { action: "paypal" as const, label: "Open a dispute at PayPal anyway", detail: "You always can, in PayPal's Resolution Center. The signed record goes with it." };
  const settle = { action: "settle" as const, label: "Ask the store to settle", detail: "Your agent asks for a refund; the store can refund, offer part of it or a replacement, and anything below your rules comes to you first." };

  if (!s) return { ...base, favours: "unclear", headline: `${o.merchant} did not answer from its own records`,
    why: "This store has no way to tell the gateway what it shipped, so only the gateway's side of the record is available. The signed record still shows exactly what was ordered and paid.",
    next: [settle, paypal] };

  if (s.status === "refunded") return { ...base, favours: "buyer", headline: "The store's records show this order was already refunded",
    why: "If the money has not reached your PayPal account, check the purchase against PayPal to see the refund's state.", next: [paypal] };

  if (claim === "unauthorised") return { ...base, favours: "store", headline: "The record shows this purchase was made inside a mandate you confirmed",
    why: `${o.agentName ?? "An agent"} asked for it under ${o.mandateName ? `the mandate “${o.mandateName}”` : "your mandate"}${o.approvedByUser ? ", and it was approved from your account before it was paid" : ""}. Every check it passed is in the signed record, which is what a store shows PayPal to answer an “unauthorised” claim. If you did not set that mandate or connect that agent, someone else has access to your account.`,
    next: [{ action: "secure", label: "Freeze spending and review your agents", detail: "Use the kill switch, revoke any agent you do not recognise, and revoke the mandate." }, settle, paypal] };

  if (claim === "not_received") {
    if (!shipped) return { ...base, favours: "buyer", headline: "The store's own records show it has not shipped this order",
      why: "Both records agree you paid and nothing has been sent. The store can cancel the order and refund you in full now.",
      next: [{ action: "refund", label: "Cancel and get the refund", detail: `Your agent asks ${o.merchant} for the ${amount}; a store that has not shipped refunds in full.` }, paypal] };
    return { ...base, favours: s.tracking ? "store" : "unclear", headline: s.tracking ? "The store has a tracking number for this order" : "The store says it shipped, but has no tracking number",
      why: s.tracking ? `Tracking ${s.tracking} is the evidence PayPal asks a seller for in a “not received” dispute, and the store has also added it to the PayPal order. If the parcel is only late, waiting or asking the store is likely to get you further than a dispute.` : "Without tracking, neither record can show whether it arrived.",
      next: [{ action: "wait", label: "Check the tracking number first", detail: s.tracking ? `Look up ${s.tracking} with the carrier.` : "Ask the store where the parcel is." }, settle, paypal] };
  }

  if (!shipped) return { ...base, favours: "unclear", headline: "The store's own records show nothing has shipped for this order yet",
    why: "That does not fit with a parcel having arrived, and the records cannot explain the difference. If something did arrive, the store needs to hear what it was; if nothing has, choose “It never arrived” to cancel and be refunded.",
    next: [settle, paypal] };

  if (claim === "wrong_item") {
    if (s.shippedSku && s.shippedSku !== s.orderedSku) return { ...base, favours: "buyer", headline: "The store's own records show it shipped a different item",
      why: `It shipped ${s.shippedSku} against an order for ${s.orderedSku}. The two records settle this: the store refunds in full without a dispute.`,
      next: [{ action: "refund", label: "Get the refund", detail: `Your agent sends ${o.merchant} the signed record; its own fulfilment record confirms the mistake.` }, paypal] };
    return { ...base, favours: "unclear", headline: "Both records say the right item was shipped",
      why: "The store's fulfilment record matches the order, so it cannot confirm a mix-up from its side. It may still offer part of the price back or a replacement.",
      next: [settle, paypal] };
  }

  // Damaged or not as described: neither record can see the parcel.
  return { ...base, favours: "unclear", headline: "Neither record can show the item's condition on arrival",
    why: s.replacementSent ? "The store has already sent a replacement for this order." : "The records agree on what was ordered, paid and shipped, which is all they can show. Stores usually answer this with a replacement or part of the price back.",
    next: [settle, paypal] };
}

async function storeStatement(ordersUrl: string | null, purchaseId: string, captureId: string | null): Promise<StoreStatement | null> {
  if (!ordersUrl || !captureId) return null;
  try {
    const res = await fetch(`${ordersUrl}/statement`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purchaseId, captureId }), signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<StoreStatement>;
    if (typeof j.status !== "string" || typeof j.orderedSku !== "string") return null;
    return { status: j.status as StoreStatement["status"], orderedSku: j.orderedSku.slice(0, 80), shippedSku: typeof j.shippedSku === "string" ? j.shippedSku.slice(0, 80) : null,
      tracking: typeof j.tracking === "string" ? j.tracking.slice(0, 64) : null, replacementSent: j.replacementSent === true };
  } catch { return null; }
}

/** Assess a complaint about a paid purchase against both records, and write the assessment to the signed ledger. */
export async function assessClaim(userId: string, purchaseId: string, claim: ClaimKind): Promise<Assessment> {
  if (!CLAIMS.some((c) => c.kind === claim)) throw new Error("Unknown kind of problem");
  const [p] = await db.select().from(schema.purchases).where(and(eq(schema.purchases.id, purchaseId), eq(schema.purchases.userId, userId)));
  if (!p || !p.merchantId || !p.product) throw new Error("Purchase not found");
  if (!["captured", "partially_refunded", "refund_requested", "disputed"].includes(p.status)) throw new Error(`This purchase is ${p.status.replace(/_/g, " ")}, so there is nothing to assess.`);
  const [[m], [mandate], [agent], entries] = await Promise.all([
    db.select().from(schema.merchants).where(eq(schema.merchants.id, p.merchantId)),
    p.mandateId ? db.select().from(schema.mandates).where(eq(schema.mandates.id, p.mandateId)) : Promise.resolve([]),
    p.agentId ? db.select().from(schema.agents).where(eq(schema.agents.id, p.agentId)) : Promise.resolve([]),
    db.select().from(schema.ledger).where(eq(schema.ledger.purchaseId, purchaseId)).orderBy(asc(schema.ledger.seq)),
  ]);
  const captured = entries.find((e) => e.type === "payment.captured");
  const a = compare(claim, {
    sku: p.product.sku, name: p.product.name, amountCents: p.amountCents, currency: p.currency, merchant: m.name, paidAt: captured?.at ?? null,
    mandateName: mandate?.name ?? null, agentName: agent?.name ?? null, approvedByUser: entries.some((e) => e.type === "purchase.approved_by_user"),
    chargedOnShipment: (captured?.payload as { chargedOnShipment?: boolean } | undefined)?.chargedOnShipment === true,
  }, await storeStatement(m.ordersUrl, p.id, p.paypalCaptureId));
  await append({ userId, purchaseId, type: "claim.assessed", payload: { claim, favours: a.favours, headline: a.headline, storeAnswered: a.storeAnswered, facts: a.facts } });
  return a;
}
