import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { appUrl, storePayee } from "./config";
import { db, schema, type Tx } from "./db";
import { canonical, newId, sha256 } from "./ids";
import { append, evidenceBundle } from "./ledger";
import { analyseProblem, classifyProduct } from "./llm";
import { PayPalError, payWithVault } from "./paypal";
import { evaluate, type Decision } from "./policy";
import { fetchProduct } from "./product";
import type { MandateRules } from "./rules";
import { STORES } from "./stores/catalog";

const { purchases, mandates, merchants, paypalLinks, agents, cases } = schema;
/** Purchases that count against the mandate's budget. A refund gives the money back to the budget. */
const COMMITTED = ["pending_approval", "paying", "captured", "refund_requested", "disputed"] as const;

// ---- Merchant registry ----------------------------------------------------------------------

let seeded: Promise<void> | null = null;
/** Register the two demo stores. One is verified, one is not. */
export const ensureSeed = () => (seeded ??= (async () => {
  for (const s of STORES) {
    const payee = storePayee(s.slug);
    const row = { name: s.name, baseUrl: `${appUrl()}/stores/${s.slug}`, verified: s.verified, paypalMerchantId: payee.merchantId, paypalEmail: payee.email };
    await db.insert(merchants).values({ id: `mer_${s.slug}`, ...row }).onConflictDoUpdate({ target: merchants.id, set: row });
  }
})().catch((e) => { seeded = null; throw e; }));

export async function resolveMerchant(productUrl: string) {
  await ensureSeed();
  let u: URL;
  try { u = new URL(productUrl); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const all = await db.select().from(merchants);
  const norm = u.toString();
  return all.find((m) => norm === m.baseUrl || norm.startsWith(`${m.baseUrl}/`)) ?? null;
}

/**
 * Turn the merchant names a person wrote ("Stride") into the registry's exact names ("Stride Running Co.").
 * This runs before the user confirms, so they approve the resolved name. The policy engine then matches exactly.
 */
export async function resolveMerchantNames(names: string[]) {
  await ensureSeed();
  const all = await db.select().from(merchants);
  const words = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const resolved: string[] = [], unknown: string[] = [];
  for (const raw of names) {
    const w = words(raw), host = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const hits = all.filter((m) => {
      const mw = words(m.name);
      const mHost = (() => { try { return new URL(m.baseUrl).hostname; } catch { return ""; } })();
      return (w.length > 0 && w.every((t, i) => mw[i] === t)) || (host.includes(".") && mHost === host);
    });
    if (hits.length === 1) { if (!resolved.includes(hits[0].name)) resolved.push(hits[0].name); }
    else { unknown.push(raw); resolved.push(raw); }
  }
  return { resolved, unknown };
}

// ---- Mandates and agents --------------------------------------------------------------------

export const rulesHash = (r: MandateRules) => sha256(canonical(r));
export async function activeMandate(userId: string) {
  const [m] = await db.select().from(mandates).where(and(eq(mandates.userId, userId), eq(mandates.status, "active"))).orderBy(desc(mandates.confirmedAt)).limit(1);
  return m ?? null;
}
export async function committedSpend(t: Tx | typeof db, mandateId: string, excludePurchaseId?: string) {
  const [r] = await t.select({ cents: sql<number>`coalesce(sum(${purchases.amountCents}), 0)::int`, n: sql<number>`count(*)::int` })
    .from(purchases).where(and(eq(purchases.mandateId, mandateId), inArray(purchases.status, [...COMMITTED]), excludePurchaseId ? ne(purchases.id, excludePurchaseId) : undefined));
  return { committedCents: r.cents, purchaseCount: r.n };
}
export async function confirmMandate(userId: string, sourceText: string, rules: MandateRules) {
  return db.transaction(async (t) => {
    const old = await t.update(mandates).set({ status: "revoked" }).where(and(eq(mandates.userId, userId), eq(mandates.status, "active"))).returning({ id: mandates.id });
    for (const o of old) await append({ userId, type: "mandate.revoked", payload: { mandateId: o.id, reason: "replaced" } }, t);
    const [m] = await t.insert(mandates).values({ id: newId("man"), userId, sourceText, rules, rulesHash: rulesHash(rules), status: "active", confirmedAt: new Date() }).returning();
    await append({ userId, type: "mandate.confirmed", payload: { mandateId: m.id, sourceText, rules, rulesHash: m.rulesHash } }, t);
    return m;
  });
}
export async function revokeMandate(userId: string) {
  const old = await db.update(mandates).set({ status: "revoked" }).where(and(eq(mandates.userId, userId), eq(mandates.status, "active"))).returning({ id: mandates.id });
  for (const o of old) await append({ userId, type: "mandate.revoked", payload: { mandateId: o.id, reason: "revoked by user" } });
}
export async function createAgent(userId: string, name: string) {
  const key = `mk_${newId("live").slice(5)}${newId("x").slice(2)}`;
  const [a] = await db.insert(agents).values({ id: newId("agt"), userId, name: name.slice(0, 60) || "Agent", keyHash: sha256(key), keyPrefix: key.slice(0, 9) }).returning();
  return { agent: a, key };
}
export async function agentFromKey(key: string | null | undefined) {
  if (!key) return null;
  const [a] = await db.select().from(agents).where(eq(agents.keyHash, sha256(key))).limit(1);
  return a && !a.revokedAt ? a : null;
}

// ---- Purchases ------------------------------------------------------------------------------

export type PurchaseInput = { productUrl: string; quantity: number; expectedPriceCents: number | null; userRequest: string; reason: string | null };
const lockUser = (t: Tx, userId: string) => t.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

export async function requestPurchase(agent: { id: string; userId: string; name: string }, input: PurchaseInput) {
  const userId = agent.userId;
  const merchant = await resolveMerchant(input.productUrl);
  // The gateway only ever fetches pages under a registered merchant's base URL.
  const product = merchant ? await fetchProduct(input.productUrl) : null;
  const mandate = await activeMandate(userId);
  const classification = product && mandate ? await classifyProduct(product, mandate.rules.allowedCategories) : null;
  const [link] = await db.select().from(paypalLinks).where(eq(paypalLinks.userId, userId));

  const purchase = await db.transaction(async (t) => {
    await lockUser(t, userId);
    const spend = mandate ? await committedSpend(t, mandate.id) : { committedCents: 0, purchaseCount: 0 };
    const decision = evaluate({
      now: new Date(), mandate: mandate ? { status: mandate.status, rules: mandate.rules } : null,
      merchant: merchant ? { name: merchant.name, baseUrl: merchant.baseUrl, verified: merchant.verified, payable: true } : null,
      product: product ? { name: product.name, priceCents: product.priceCents, currency: product.currency } : null,
      quantity: input.quantity, agentExpectedPriceCents: input.expectedPriceCents, spend, classification,
      paymentMethodLinked: link?.status === "active" && !!link.vaultId,
    });
    const id = newId("pur");
    const status = decision.outcome === "approve" ? "paying" : decision.outcome === "needs_approval" ? "pending_approval" : "blocked";
    await append({ userId, purchaseId: id, type: "purchase.requested", payload: {
      agent: { id: agent.id, name: agent.name }, userRequest: input.userRequest, agentReason: input.reason,
      productUrl: input.productUrl, quantity: input.quantity, agentExpectedPriceCents: input.expectedPriceCents,
      merchant: merchant ? { id: merchant.id, name: merchant.name, baseUrl: merchant.baseUrl, verified: merchant.verified } : null,
      productSeenByGateway: product, mandate: mandate ? { id: mandate.id, rulesHash: mandate.rulesHash, sourceText: mandate.sourceText } : null,
    } }, t);
    await append({ userId, purchaseId: id, type: "purchase.decided", payload: { ...decision, classification, spendBefore: spend } }, t);
    const [row] = await t.insert(purchases).values({
      id, userId, mandateId: mandate?.id ?? null, agentId: agent.id, merchantId: merchant?.id ?? null, status,
      productUrl: input.productUrl, product, quantity: input.quantity, amountCents: (product?.priceCents ?? 0) * Math.max(input.quantity, 0),
      currency: product?.currency ?? mandate?.rules.currency ?? "USD", userRequest: input.userRequest, agentReason: input.reason, decision,
    }).returning();
    return row;
  });
  return purchase.status === "paying" ? pay(purchase.id) : purchase;
}

/** Charge the vaulted wallet. Only ever called after the policy engine (or the user) approved. */
export async function pay(purchaseId: string) {
  const [p] = await db.select().from(purchases).where(eq(purchases.id, purchaseId));
  if (!p || p.status !== "paying" || !p.product || !p.merchantId) throw new Error("Purchase is not payable");
  const [m] = await db.select().from(merchants).where(eq(merchants.id, p.merchantId));
  const [link] = await db.select().from(paypalLinks).where(eq(paypalLinks.userId, p.userId));
  const set = async (v: Partial<typeof purchases.$inferInsert>) => (await db.update(purchases).set({ ...v, updatedAt: new Date() }).where(eq(purchases.id, p.id)).returning())[0];
  try {
    const payee = process.env.PAYPAL_PAYEE_MODE === "platform" ? null : { merchantId: m.paypalMerchantId, email: m.paypalEmail };
    const r = await payWithVault({
      vaultId: link.vaultId!, amountCents: p.amountCents, currency: p.currency, referenceId: p.id, payee,
      description: `${p.product.name} from ${m.name}`, itemName: p.product.name, sku: p.product.sku, quantity: p.quantity, unitCents: p.product.priceCents,
    });
    if (r.status !== "COMPLETED" || !r.captureId) {
      await append({ userId: p.userId, purchaseId: p.id, type: "payment.failed", payload: { orderId: r.orderId, status: r.status, captureStatus: r.captureStatus } });
      return set({ status: "payment_failed", paypalOrderId: r.orderId });
    }
    const entry = await append({ userId: p.userId, purchaseId: p.id, type: "payment.captured", payload: {
      paypalOrderId: r.orderId, paypalCaptureId: r.captureId, amountCents: p.amountCents, currency: p.currency,
      merchant: { id: m.id, name: m.name, baseUrl: m.baseUrl }, sku: p.product.sku, productName: p.product.name, quantity: p.quantity } });
    const row = await set({ status: "captured", paypalOrderId: r.orderId, paypalCaptureId: r.captureId });
    // Tell the merchant it has a paid order to fulfil, with the signed capture record as proof.
    // Awaited, because a serverless host may stop the function as soon as the response is sent.
    await fetch(`${m.baseUrl}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry }), signal: AbortSignal.timeout(15_000) })
      .catch((e) => console.error("merchant order notification failed:", e));
    return row;
  } catch (e) {
    const detail = e instanceof PayPalError ? { status: e.status, issue: e.issue, debugId: e.debugId, body: e.body } : { message: String(e) };
    console.error("payment failed:", e);
    await append({ userId: p.userId, purchaseId: p.id, type: "payment.failed", payload: detail as Record<string, unknown> });
    return set({ status: "payment_failed" });
  }
}

/** The one-tap approval. Limits are re-checked in code: approval never lifts the mandate's ceiling. */
export async function decideApproval(userId: string, purchaseId: string, approve: boolean) {
  const result = await db.transaction(async (t) => {
    await lockUser(t, userId);
    const [p] = await t.select().from(purchases).where(and(eq(purchases.id, purchaseId), eq(purchases.userId, userId)));
    if (!p || p.status !== "pending_approval") throw new Error("Nothing to approve");
    const upd = async (status: "declined" | "paying" | "blocked", decision?: Decision) =>
      (await t.update(purchases).set({ status, updatedAt: new Date(), ...(decision ? { decision } : {}) }).where(eq(purchases.id, p.id)).returning())[0];
    if (!approve) {
      await append({ userId, purchaseId, type: "purchase.declined_by_user", payload: {} }, t);
      return upd("declined");
    }
    const [m] = p.mandateId ? await t.select().from(mandates).where(eq(mandates.id, p.mandateId)) : [];
    const spend = m ? await committedSpend(t, m.id, p.id) : { committedCents: 0, purchaseCount: 0 };
    const stillOk = !!m && m.status === "active" && new Date() < new Date(m.rules.expiresAt) && p.amountCents <= m.rules.totalLimitCents - spend.committedCents;
    if (!stillOk) {
      const decision: Decision = { ...p.decision, outcome: "block", reason: "Approved by the user, but the mandate no longer covers it (revoked, expired or out of budget)." };
      await append({ userId, purchaseId, type: "purchase.decided", payload: decision }, t);
      return upd("blocked", decision);
    }
    await append({ userId, purchaseId, type: "purchase.approved_by_user", payload: { amountCents: p.amountCents } }, t);
    return upd("paying");
  });
  return result.status === "paying" ? pay(result.id) : result;
}

// ---- After the purchase: problems, refunds, disputes ----------------------------------------

export async function reportProblem(userId: string, purchaseId: string, report: string) {
  const [p] = await db.select().from(purchases).where(and(eq(purchases.id, purchaseId), eq(purchases.userId, userId)));
  if (!p || !p.merchantId) throw new Error("Purchase not found");
  if (p.status !== "captured") throw new Error(`This purchase is ${p.status.replace("_", " ")}, so there is nothing to refund.`);
  const [m] = await db.select().from(merchants).where(eq(merchants.id, p.merchantId));
  const [c] = await db.insert(cases).values({ id: newId("case"), purchaseId, userId, report, status: "open" }).returning();
  await append({ userId, purchaseId, type: "problem.reported", payload: { caseId: c.id, report } });

  const analysis = await analyseProblem(report, { userRequest: p.userRequest, ordered: { name: p.product?.name, sku: p.product?.sku, description: p.product?.description, priceCents: p.product?.priceCents, quantity: p.quantity, merchant: m.name } });
  await append({ userId, purchaseId, type: "refund.requested", payload: { caseId: c.id, merchant: m.name, claim: analysis } });
  await db.update(purchases).set({ status: "refund_requested", updatedAt: new Date() }).where(eq(purchases.id, p.id));

  // Send the claim to the merchant with the signed evidence record attached.
  let reply: { decision: "refunded" | "declined"; refundId?: string; reason?: string };
  try {
    const res = await fetch(`${m.baseUrl}/api/returns`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseId, claim: analysis, report, evidence: await evidenceBundle(purchaseId) }), signal: AbortSignal.timeout(30_000) });
    reply = await res.json();
    if (!res.ok) throw new Error((reply as { error?: string }).error ?? `merchant returned ${res.status}`);
  } catch (e) { reply = { decision: "declined", reason: `The merchant could not be reached: ${e instanceof Error ? e.message : e}` }; }

  if (reply.decision === "refunded") {
    await append({ userId, purchaseId, type: "refund.completed", payload: { caseId: c.id, paypalRefundId: reply.refundId, amountCents: p.amountCents, by: m.name } });
    await db.update(purchases).set({ status: "refunded", paypalRefundId: reply.refundId, updatedAt: new Date() }).where(eq(purchases.id, p.id));
    const [row] = await db.update(cases).set({ status: "refunded", analysis, merchantResponse: reply, paypalRefundId: reply.refundId, updatedAt: new Date() }).where(eq(cases.id, c.id)).returning();
    return { case: row, message: `${m.name} accepted the evidence and refunded ${(p.amountCents / 100).toFixed(2)} ${p.currency} to your PayPal account.` };
  }
  await append({ userId, purchaseId, type: "merchant.declined", payload: { caseId: c.id, reason: reply.reason } });
  await db.update(purchases).set({ status: "captured", updatedAt: new Date() }).where(eq(purchases.id, p.id));
  const [row] = await db.update(cases).set({ status: "merchant_declined", analysis, merchantResponse: reply, updatedAt: new Date() }).where(eq(cases.id, c.id)).returning();
  return { case: row, message: `${m.name} declined the refund: ${reply.reason}. You can open a dispute in PayPal's Resolution Center for transaction ${p.paypalCaptureId}; the evidence record for this purchase is ready to attach.` };
}

/** Apply a PayPal webhook to the gateway's records. */
export async function applyWebhook(eventType: string, resource: Record<string, unknown>) {
  const find = async (captureId: string | undefined) => captureId ? (await db.select().from(purchases).where(eq(purchases.paypalCaptureId, captureId)))[0] : undefined;
  if (eventType === "PAYMENT.CAPTURE.REFUNDED") {
    const up = (resource.links as { rel: string; href: string }[] | undefined)?.find((l) => l.rel === "up")?.href;
    const p = await find(up?.split("/").pop());
    if (p && p.status !== "refunded") {
      await db.update(purchases).set({ status: "refunded", paypalRefundId: String(resource.id), updatedAt: new Date() }).where(eq(purchases.id, p.id));
      await append({ userId: p.userId, purchaseId: p.id, type: "refund.completed", payload: { paypalRefundId: resource.id, confirmedBy: "paypal webhook" } });
    }
    return p?.id ?? null;
  }
  if (eventType.startsWith("CUSTOMER.DISPUTE.")) {
    const txs = (resource.disputed_transactions as { seller_transaction_id?: string; buyer_transaction_id?: string }[] | undefined) ?? [];
    const p = (await find(txs[0]?.seller_transaction_id)) ?? (await find(txs[0]?.buyer_transaction_id));
    if (p) {
      const resolved = eventType === "CUSTOMER.DISPUTE.RESOLVED";
      const outcome = (resource.dispute_outcome as { outcome_code?: string } | undefined)?.outcome_code ?? null;
      await db.update(purchases).set({ status: resolved && outcome?.includes("BUYER") ? "refunded" : resolved ? "captured" : "disputed", updatedAt: new Date() }).where(eq(purchases.id, p.id));
      await append({ userId: p.userId, purchaseId: p.id, type: "dispute.opened", payload: { event: eventType, disputeId: resource.dispute_id, reason: resource.reason, status: resource.status, outcome } });
    }
    return p?.id ?? null;
  }
  return null;
}
