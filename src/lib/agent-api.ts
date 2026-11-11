// What an agent sees, whichever door it comes through. The MCP server and the REST API both call these.
import { and, eq } from "drizzle-orm";
import { appUrl } from "./config";
import { db, schema } from "./db";
import { activeMandates, checkPurchase, committedSpend, reportProblem, requestPurchase, type AgentRef } from "./gateway";
import { money } from "./ids";

type Purchase = typeof schema.purchases.$inferSelect;

export type PurchaseRequest = { product_url: string; quantity?: number; expected_price: number; user_request: string; reason?: string | null; idempotency_key?: string | null };
const toInput = (a: PurchaseRequest) => ({
  productUrl: a.product_url, quantity: a.quantity ?? 1, expectedPriceCents: Math.round(a.expected_price * 100),
  userRequest: a.user_request, reason: a.reason ?? null, idempotencyKey: a.idempotency_key ?? null,
});

/** Validate a purchase request that arrived as JSON. Returns a message when it is not usable. */
export function parsePurchaseRequest(b: unknown): PurchaseRequest | string {
  const o = (b ?? {}) as Record<string, unknown>;
  if (typeof o.product_url !== "string" || !o.product_url) return "product_url is required";
  if (typeof o.expected_price !== "number" || !(o.expected_price > 0)) return "expected_price must be a positive number";
  if (typeof o.user_request !== "string" || o.user_request.trim().length < 3) return "user_request is required: what the user asked for, in their own words";
  const q = o.quantity === undefined ? 1 : o.quantity;
  if (typeof q !== "number" || !Number.isInteger(q) || q < 1 || q > 20) return "quantity must be a whole number from 1 to 20";
  return { product_url: o.product_url, expected_price: o.expected_price, user_request: o.user_request, quantity: q,
    reason: typeof o.reason === "string" ? o.reason : null, idempotency_key: typeof o.idempotency_key === "string" ? o.idempotency_key.slice(0, 120) : null };
}

export function describePurchase(p: Purchase) {
  const amount = p.product ? money(p.amountCents, p.currency) : null;
  const base = { purchase_id: p.id, status: p.status, product: p.product?.name ?? null, amount, record: `${appUrl()}/purchases/${p.id}` };
  switch (p.status) {
    case "captured": return { ...base, message: `Paid. ${amount} was charged to the user's PayPal account. PayPal order ${p.paypalOrderId}.` };
    case "authorized": return { ...base, message: `Reserved. ${amount} is held on the user's PayPal account and will be charged when the store ships. PayPal order ${p.paypalOrderId}. The purchase is made; do not request it again.` };
    case "cancelled": return { ...base, message: "The user cancelled this purchase before it shipped. Nothing was charged." };
    case "blocked": return { ...base, message: `BLOCKED by the user's mandate: ${p.decision.reason} This decision is final for this product. Do not try to work around it; tell the user what was blocked and why.` };
    case "pending_approval": return { ...base, approval_url: p.approvalToken ? `${appUrl()}/approve/${p.approvalToken}` : appUrl(),
      message: `Waiting for the user's approval: ${p.decision.reason} Give the user the approval_url (or ask them to open their Mandate dashboard), then call check_status. Do not request this purchase again.` };
    case "payment_failed": return { ...base, message: "The purchase was approved but PayPal did not complete the payment. Nothing was charged." };
    case "declined": return { ...base, message: "The user declined this purchase." };
    case "refunded": return { ...base, message: "This purchase was refunded in full to the user's PayPal account." };
    case "partially_refunded": return { ...base, message: `${money(p.refundedCents, p.currency)} of this purchase was refunded to the user's PayPal account under an agreed settlement.` };
    case "refund_requested": return { ...base, message: "A problem was reported and the merchant is being asked for a refund." };
    case "disputed": return { ...base, message: "This purchase is in a PayPal dispute." };
    default: return { ...base, message: `Status: ${p.status}.` };
  }
}

export async function mandateView(agent: AgentRef) {
  const list = await activeMandates(agent.userId, agent.id);
  if (!list.length) return { active: false as const, message: `The user has no active mandate for this agent. Ask them to set one at ${appUrl()}.` };
  const one = async (m: (typeof list)[number]) => {
    const spend = await committedSpend(db, m.id);
    const r = m.rules, cur = r.currency;
    return {
      mandate_id: m.id, name: m.name, summary: r.summary, currency: cur,
      remaining: money(r.totalLimitCents - spend.committedCents, cur), total_limit: money(r.totalLimitCents, cur),
      per_purchase_limit: r.perPurchaseLimitCents === null ? null : money(r.perPurchaseLimitCents, cur),
      daily_limit: r.dailyLimitCents == null ? null : money(r.dailyLimitCents, cur),
      remaining_today: r.dailyLimitCents == null ? null : money(Math.max(r.dailyLimitCents - spend.todayCents, 0), cur),
      per_merchant_limit: r.perMerchantLimitCents == null ? null : money(r.perMerchantLimitCents, cur),
      needs_user_approval_above: r.approvalThresholdCents === null ? null : money(r.approvalThresholdCents, cur),
      allowed_categories: r.allowedCategories, merchants: r.merchantPolicy === "allowlist" ? r.allowedMerchants : r.merchantPolicy,
      never_buy_from: r.blockedMerchants ?? [], expires_at: r.expiresAt,
    };
  };
  const views = await Promise.all(list.map(one));
  // The first mandate is spread at the top level so agents written for a single mandate keep working.
  return { active: true as const, ...views[0], mandates: views };
}

export const submitPurchase = async (agent: AgentRef, a: PurchaseRequest) => describePurchase(await requestPurchase(agent, toInput(a)));

export async function previewPurchase(agent: AgentRef, a: PurchaseRequest) {
  const r = await checkPurchase(agent, toInput(a));
  const verb = r.decision.outcome === "approve" ? "would be paid immediately" : r.decision.outcome === "needs_approval" ? "would need the user's approval" : "would be BLOCKED";
  return { would: r.decision.outcome, product: r.product?.name ?? null, amount: r.product ? money(r.amountCents, r.product.currency) : null, merchant: r.merchant?.name ?? null,
    message: `This purchase ${verb}: ${r.decision.reason} Nothing was charged or recorded.`, failed_checks: r.decision.checks.filter((c) => !c.passed).map((c) => ({ rule: c.rule, detail: c.detail })) };
}

export async function purchaseStatus(agent: AgentRef, id: string) {
  const [p] = await db.select().from(schema.purchases).where(and(eq(schema.purchases.id, id), eq(schema.purchases.userId, agent.userId)));
  return p ? describePurchase(p) : null;
}

export async function submitProblem(agent: AgentRef, purchaseId: string, description: string) {
  try { const r = await reportProblem(agent.userId, purchaseId, description); return { case_id: r.case.id, status: r.case.status, message: r.message }; }
  catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}
