// The merchant's side. Everything here runs as the store, with the store's own PayPal credentials
// and its own order book. It trusts the gateway only as far as the gateway's signature verifies.
import { and, eq } from "drizzle-orm";
import { gatewayCreds, storeCreds } from "../config";
import { db, schema } from "../db";
import { newId } from "../ids";
import { publicKeyPem, verifyBundle, type LedgerRow } from "../ledger";
import { acceptClaim, listDisputes, refundCapture, sendDisputeMessage, type Dispute } from "../paypal";
import { getProduct } from "./catalog";

const { storeOrders } = schema;
/** A real merchant pins this from the gateway's /.well-known/mandate-gateway.json. */
const pinnedGatewayKey = () => publicKeyPem();
const creds = (slug: string) => storeCreds(slug) ?? gatewayCreds();

/** A paid order arrives from the gateway. Accept it only if the signed capture record verifies. */
export async function recordOrder(slug: string, entry: LedgerRow) {
  const v = verifyBundle({ publicKey: pinnedGatewayKey(), entries: [entry] }, pinnedGatewayKey());
  if (!v.ok || entry.type !== "payment.captured" || !entry.purchaseId) throw new Error(`Rejected: ${v.ok ? "not a capture record" : v.why}`);
  const pl = entry.payload as { paypalOrderId: string; paypalCaptureId: string; amountCents: number; sku: string };
  const [existing] = await db.select().from(storeOrders).where(eq(storeOrders.gatewayPurchaseId, entry.purchaseId));
  if (existing) return existing;
  const [o] = await db.insert(storeOrders).values({ id: newId("ord"), storeSlug: slug, gatewayPurchaseId: entry.purchaseId, paypalOrderId: pl.paypalOrderId,
    paypalCaptureId: pl.paypalCaptureId, sku: pl.sku, amountCents: pl.amountCents, status: "paid" }).returning();
  return o;
}

export async function shipOrder(slug: string, orderId: string, shippedSku: string) {
  const [o] = await db.update(storeOrders).set({ status: "shipped", shippedSku }).where(and(eq(storeOrders.id, orderId), eq(storeOrders.storeSlug, slug), eq(storeOrders.status, "paid"))).returning();
  return o ?? null;
}

type Claim = { issue: string; summary: string };
/** Does the store's own fulfilment record back the buyer's claim? */
function assess(o: typeof storeOrders.$inferSelect, issue: string) {
  if (o.status === "refunded") return { agree: false, reason: "This order has already been refunded." };
  if (o.status === "paid") return ["not_received", "unauthorised", "changed_mind", "other", "wrong_item"].includes(issue)
    ? { agree: true, reason: "The order has not shipped, so it can be cancelled and refunded." } : { agree: false, reason: "The order has not shipped yet." };
  if (o.shippedSku && o.shippedSku !== o.sku)
    return { agree: true, reason: `Our fulfilment record shows ${o.shippedSku} was shipped against an order for ${o.sku}.` };
  return { agree: false, reason: `Our fulfilment record shows the ordered item (${o.sku}) was shipped.` };
}

/** The merchant's returns agent: verify the evidence, check it against our own records, refund if they agree. */
export async function handleReturn(slug: string, body: { purchaseId: string; claim: Claim; evidence: { publicKey: string; entries: LedgerRow[] } }) {
  const v = verifyBundle(body.evidence, pinnedGatewayKey());
  if (!v.ok) return { decision: "declined" as const, reason: `The evidence record failed verification (${v.why})` };
  const captured = body.evidence.entries.find((e) => e.type === "payment.captured" && e.purchaseId === body.purchaseId);
  const [o] = await db.select().from(storeOrders).where(and(eq(storeOrders.gatewayPurchaseId, body.purchaseId), eq(storeOrders.storeSlug, slug)));
  if (!o || !captured || (captured.payload as { paypalCaptureId?: string }).paypalCaptureId !== o.paypalCaptureId)
    return { decision: "declined" as const, reason: "We have no order matching that evidence record" };
  const a = assess(o, body.claim.issue);
  if (!a.agree) { await db.update(storeOrders).set({ note: `Refund declined: ${a.reason}` }).where(eq(storeOrders.id, o.id)); return { decision: "declined" as const, reason: a.reason }; }
  const refund = await refundCapture(creds(slug), o.paypalCaptureId!, { note: `Refund for ${getProduct(slug, o.sku)?.name ?? o.sku}: ${a.reason}`, requestId: `refund-${o.id}` });
  await db.update(storeOrders).set({ status: "refunded", paypalRefundId: refund.id, note: a.reason, evidence: body.evidence as unknown as Record<string, unknown> }).where(eq(storeOrders.id, o.id));
  return { decision: "refunded" as const, refundId: refund.id, reason: a.reason };
}

/** The merchant's dispute agent: for each open PayPal dispute, concede when our records agree with the buyer, contest otherwise. */
export async function handleDispute(slug: string, d: Dispute) {
  const c = storeCreds(slug);
  const captureId = d.disputed_transactions?.[0]?.seller_transaction_id;
  const [o] = captureId ? await db.select().from(storeOrders).where(and(eq(storeOrders.paypalCaptureId, captureId), eq(storeOrders.storeSlug, slug))) : [];
  if (!c || !o) return { disputeId: d.dispute_id, action: "ignored", reason: "no matching order" };
  if (o.disputeStatus === "conceded" || o.disputeStatus === "contested") return { disputeId: d.dispute_id, action: "already_handled" };
  const issue = d.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" ? "not_received" : d.reason === "UNAUTHORISED" ? "unauthorised" : "wrong_item";
  const a = assess(o, issue);
  if (a.agree) {
    await acceptClaim(c, d.dispute_id, `Conceding: ${a.reason} Full refund issued.`);
    await db.update(storeOrders).set({ disputeId: d.dispute_id, disputeStatus: "conceded", status: "refunded", note: a.reason }).where(eq(storeOrders.id, o.id));
    return { disputeId: d.dispute_id, action: "accepted_claim", reason: a.reason };
  }
  const authorised = issue === "unauthorised" ? " The buyer's signed mandate authorising their agent to make this purchase is on file and available on request." : "";
  await sendDisputeMessage(c, d.dispute_id, `${a.reason}${authorised} Order reference ${o.id}.`).catch((e) => console.error("dispute message failed:", e));
  await db.update(storeOrders).set({ disputeId: d.dispute_id, disputeStatus: "contested", note: a.reason }).where(eq(storeOrders.id, o.id));
  return { disputeId: d.dispute_id, action: "contested", reason: a.reason };
}

export async function syncDisputes(slug: string) {
  const c = storeCreds(slug);
  if (!c) return { error: "This store has no PayPal credentials configured" };
  const { items = [] } = await listDisputes(c);
  const open = items.filter((d) => !["RESOLVED"].includes(d.status));
  return { handled: await Promise.all(open.map((d) => handleDispute(slug, d))) };
}
