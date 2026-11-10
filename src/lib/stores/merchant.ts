// The merchant's side. Everything here runs as the store, with the store's own PayPal credentials
// and its own order book. It trusts the gateway only as far as the gateway's signature verifies.
import { and, eq } from "drizzle-orm";
import { appUrl, gatewayCreds, paypalBase, storeCreds } from "../config";
import { db, schema } from "../db";
import { newId } from "../ids";
import { publicKeyPem, verifyBundle, type LedgerRow } from "../ledger";
import { acceptClaim, adjudicate, getDispute, listDisputes, provideEvidence, refundCapture, sendDisputeMessage, type Dispute } from "../paypal";
import { textPdf } from "../pdf";
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
  const [o] = await db.update(storeOrders).set({ status: "shipped", shippedSku, tracking: `STR${Date.now().toString(36).toUpperCase()}` }).where(and(eq(storeOrders.id, orderId), eq(storeOrders.storeSlug, slug), eq(storeOrders.status, "paid"))).returning();
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

type Bundle = { publicKey: string; entries: LedgerRow[] };
/** The evidence record as a document PayPal accepts. Every line comes from a signed ledger entry. */
export function evidencePdf(o: typeof storeOrders.$inferSelect, b: Bundle, disputeId: string) {
  const get = (t: string) => b.entries.find((e) => e.type === t);
  const req = get("purchase.requested")?.payload as Record<string, unknown> | undefined;
  const dec = get("purchase.decided")?.payload as { outcome?: string; reason?: string; checks?: { rule: string; passed: boolean; detail: string }[] } | undefined;
  const cap = get("payment.captured");
  const mandate = req?.mandate as { id?: string; rulesHash?: string; sourceText?: string } | null | undefined;
  const product = req?.productSeenByGateway as { name?: string; sku?: string; priceCents?: number; currency?: string; url?: string; pageSha256?: string; fetchedAt?: string } | null | undefined;
  const agent = req?.agent as { name?: string } | undefined;
  return textPdf(`Evidence record for PayPal dispute ${disputeId}`, [
    `Merchant order ${o.id}   PayPal capture ${o.paypalCaptureId}   Gateway purchase ${o.gatewayPurchaseId}`, "",
    "1. THE BUYER AUTHORISED THIS PURCHASE", `The buyer gave their AI agent this written mandate (id ${mandate?.id}):`, `  "${mandate?.sourceText}"`, `Mandate rules hash: ${mandate?.rulesHash}`,
    `The buyer asked the agent: "${req?.userRequest}"`, `Agent: ${agent?.name}. Agent's stated reason: ${req?.agentReason ?? "none given"}`, "",
    "2. WHAT WAS ORDERED", `Item: ${product?.name} (SKU ${product?.sku}), quantity ${req?.quantity}, ${((product?.priceCents ?? 0) / 100).toFixed(2)} ${product?.currency}`,
    `Product page: ${product?.url}`, `Page fetched by the gateway at ${product?.fetchedAt}, sha256 ${product?.pageSha256}`, "",
    "3. THE PURCHASE WAS CHECKED AGAINST THE MANDATE BEFORE PAYMENT", `Decision: ${dec?.outcome} - ${dec?.reason}`, ...(dec?.checks ?? []).map((c) => `  [${c.passed ? "pass" : "FAIL"}] ${c.rule}: ${c.detail}`),
    ...(get("purchase.approved_by_user") ? ["The buyer then approved this purchase personally in their dashboard."] : []), "",
    "4. PAYMENT", `Captured at ${cap?.at}: ${JSON.stringify(cap?.payload)}`, "",
    "5. FULFILMENT (merchant's own record)", `Ordered SKU ${o.sku}. Shipped SKU ${o.shippedSku ?? "not shipped"}. Tracking ${o.tracking ?? "none"}. Order status ${o.status}.`, "",
    "6. HOW TO VERIFY THIS RECORD", "Each entry below is from the gateway's append-only ledger: a sha256 hash chain with an Ed25519 signature over every hash.",
    ...b.entries.flatMap((e) => [`#${e.seq} ${e.type} at ${e.at}`, `  hash ${e.hash}`, `  sig  ${e.signature}`]), "", "Gateway public key:", ...b.publicKey.trim().split("\n"),
  ]);
}

async function gatewayEvidence(o: typeof storeOrders.$inferSelect, disputeId: string): Promise<Bundle | null> {
  try {
    const res = await fetch(`${appUrl()}/api/merchant/evidence/${o.gatewayPurchaseId}?capture=${o.paypalCaptureId}&dispute=${disputeId}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!res.ok) return null;
    const b = (await res.json()) as Bundle;
    return verifyBundle(b, pinnedGatewayKey()).ok ? b : null;
  } catch { return null; }
}

/**
 * The merchant's dispute agent. For a PayPal dispute on one of our orders it concedes when our own
 * fulfilment record agrees with the buyer, and otherwise contests with the gateway's signed evidence record.
 */
export async function handleDispute(slug: string, summary: Dispute) {
  const c = storeCreds(slug);
  if (!c) return { disputeId: summary.dispute_id, action: "ignored", reason: "store has no PayPal credentials" };
  const d = await getDispute(c, summary.dispute_id); // webhooks and lists carry a summary; the links and status come from the full record
  const captureId = d.disputed_transactions?.[0]?.seller_transaction_id;
  const [o] = captureId ? await db.select().from(storeOrders).where(and(eq(storeOrders.paypalCaptureId, captureId), eq(storeOrders.storeSlug, slug))) : [];
  if (!o) return { disputeId: d.dispute_id, action: "ignored", reason: "no matching order" };
  const can = (rel: string) => !!d.links?.some((l) => l.rel === rel);
  const save = (v: Partial<typeof storeOrders.$inferInsert>) => db.update(storeOrders).set({ disputeId: d.dispute_id, ...v }).where(eq(storeOrders.id, o.id));
  if (d.status === "RESOLVED") { await save({ disputeStatus: `resolved${d.dispute_outcome?.outcome_code ? `: ${d.dispute_outcome.outcome_code}` : ""}` }); return { disputeId: d.dispute_id, action: "none", reason: "already resolved" }; }
  if (o.disputeStatus === "conceded" || o.disputeStatus === "evidence submitted") return { disputeId: d.dispute_id, action: "none", reason: `already ${o.disputeStatus}` };

  const issue = d.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" ? "not_received" : d.reason === "UNAUTHORISED" ? "unauthorised" : "wrong_item";
  const a = issue === "unauthorised" && o.status !== "paid" ? { agree: false, reason: "The buyer's own signed mandate authorised their AI agent to make this purchase." } : assess(o, issue);
  if (a.agree) {
    await acceptClaim(c, d.dispute_id, `Conceding: ${a.reason} Full refund issued.`);
    await save({ disputeStatus: "conceded", status: "refunded", note: a.reason });
    return { disputeId: d.dispute_id, action: "accepted_claim", reason: a.reason };
  }
  const bundle = await gatewayEvidence(o, d.dispute_id);
  const notes = `${a.reason} The buyer authorised an AI agent to make this purchase under a written mandate; the attached record, signed by the payment gateway, shows the mandate, the buyer's request, the item ordered and the capture. Order ${o.id}.`;
  if (can("provide-evidence") && bundle) {
    await provideEvidence(c, d.dispute_id, { evidenceType: "PROOF_OF_FULFILLMENT", evidenceInfo: { tracking_info: [{ carrier_name: "OTHER", carrier_name_other: "Stride Logistics", tracking_number: o.tracking ?? o.id }] },
      notes, filename: `evidence-${o.id}.pdf`, file: evidencePdf(o, bundle, d.dispute_id) });
    await save({ disputeStatus: "evidence submitted", note: a.reason });
    return { disputeId: d.dispute_id, action: "provided_evidence", reason: a.reason };
  }
  if (can("send-message") && o.disputeStatus !== "contested by message") {
    await sendDisputeMessage(c, d.dispute_id, notes);
    await save({ disputeStatus: "contested by message", note: a.reason });
    return { disputeId: d.dispute_id, action: "sent_message", reason: a.reason };
  }
  await save({ disputeStatus: o.disputeStatus ?? `open (${d.status})` });
  return { disputeId: d.dispute_id, action: "waiting", reason: `nothing to do while the dispute is ${d.status}` };
}

/** Sandbox only: play the PayPal agent's ruling so the whole dispute can be exercised end to end. */
export async function sandboxRuling(slug: string, orderId: string) {
  const c = storeCreds(slug);
  const [o] = await db.select().from(storeOrders).where(and(eq(storeOrders.id, orderId), eq(storeOrders.storeSlug, slug)));
  if (!c || !o?.disputeId) return { error: "No dispute on this order" };
  if (paypalBase().includes("sandbox") === false) return { error: "Sandbox only" };
  const d = await getDispute(c, o.disputeId);
  if (!d.links?.some((l) => l.rel === "adjudicate")) return { error: `PayPal does not allow a ruling while the dispute is ${d.status}` };
  await adjudicate(c, o.disputeId, "SELLER_FAVOR");
  await db.update(storeOrders).set({ disputeStatus: "resolved: RESOLVED_SELLER_FAVOR (sandbox ruling)" }).where(eq(storeOrders.id, o.id));
  return { ok: true };
}

export async function syncDisputes(slug: string) {
  const c = storeCreds(slug);
  if (!c) return { error: "This store has no PayPal credentials configured" };
  const { items = [] } = await listDisputes(c);
  const handled = [];
  for (const d of items) handled.push(await handleDispute(slug, d).catch((e) => ({ disputeId: d.dispute_id, action: "error", reason: e instanceof Error ? e.message : String(e) })));
  return { handled };
}
