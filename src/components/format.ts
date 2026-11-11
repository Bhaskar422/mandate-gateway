// Shared wording and formatting for the whole web app. Nothing here touches dates: those are formatted in the
// browser only, by LocalTime.

export type Tone = "ok" | "warn" | "bad" | "info" | "dispute" | "flag" | "brand" | "neutral";

/** Money is stored as integer cents. */
export const money = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-03" -> "Nov 3". A plain string operation, so the server and the browser always agree. */
export const shortDay = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;

// ---- Purchases --------------------------------------------------------------------------------

export const PURCHASE_STATUS: Record<string, { label: string; tone: Tone }> = {
  captured: { label: "Paid", tone: "ok" },
  authorized: { label: "Reserved, charged on shipment", tone: "info" },
  cancelled: { label: "Cancelled, not charged", tone: "neutral" },
  paying: { label: "Paying", tone: "neutral" },
  pending_approval: { label: "Needs your approval", tone: "warn" },
  blocked: { label: "Blocked", tone: "bad" },
  declined: { label: "Declined by you", tone: "neutral" },
  payment_failed: { label: "Payment failed", tone: "bad" },
  refund_requested: { label: "Refund in progress", tone: "info" },
  refunded: { label: "Refunded", tone: "info" },
  partially_refunded: { label: "Partly refunded", tone: "info" },
  disputed: { label: "In dispute", tone: "dispute" },
};
export const purchaseStatus = (s: string) => PURCHASE_STATUS[s] ?? { label: s.replace(/_/g, " "), tone: "neutral" as Tone };

export const CASE_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Problem reported", tone: "info" },
  refund_requested: { label: "Asking the store", tone: "info" },
  offer_pending: { label: "Offer waiting for you", tone: "warn" },
  refunded: { label: "Refunded in full", tone: "info" },
  settled: { label: "Settled", tone: "info" },
  merchant_declined: { label: "Store declined", tone: "bad" },
  disputed: { label: "In dispute", tone: "dispute" },
  closed: { label: "Closed", tone: "neutral" },
};
export const caseStatus = (s: string) => CASE_STATUS[s] ?? { label: s.replace(/_/g, " "), tone: "neutral" as Tone };

type Offer = { type: "full_refund" | "partial_refund" | "replacement"; amountCents?: number; sku?: string };
/** "a partial refund of $26.70 (30% of the price)" */
export function describeOffer(o: Offer, amountCents: number, currency: string) {
  if (o.type === "full_refund") return "a full refund";
  if (o.type === "replacement") return `a replacement${o.sku ? ` (${o.sku})` : ""}`;
  const cents = o.amountCents ?? 0;
  return `a partial refund of ${money(cents, currency)} (${amountCents ? Math.round((cents / amountCents) * 100) : 0}% of the price)`;
}

// ---- Policy checks ----------------------------------------------------------------------------

/** Each check the policy engine can run: what it asks, and the short reason shown when it fails. */
export const CHECKS: Record<string, { label: string; failed: string }> = {
  account_not_frozen: { label: "Spending is not frozen", failed: "Spending was frozen" },
  agent_active: { label: "The agent is active", failed: "Agent was paused" },
  rate_limit: { label: "Not too many requests at once", failed: "Too many requests" },
  mandate_active: { label: "A mandate covers this agent", failed: "No active mandate" },
  mandate_not_expired: { label: "The mandate has not expired", failed: "Mandate expired" },
  payment_method: { label: "PayPal is linked", failed: "PayPal not linked" },
  merchant_registered: { label: "The store is known to the gateway", failed: "Unknown store" },
  merchant_not_blocked: { label: "The store is not on your never-buy list", failed: "Store on never-buy list" },
  merchant_verified: { label: "The store is verified", failed: "Store not verified" },
  merchant_allowlisted: { label: "The store is one you named", failed: "Store not on your list" },
  merchant_payable: { label: "The store has a confirmed PayPal payee", failed: "Store cannot be paid" },
  product_readable: { label: "The gateway read the product page itself", failed: "Product page unreadable" },
  quantity_valid: { label: "The quantity is sensible", failed: "Invalid quantity" },
  currency_matches: { label: "The currency matches the mandate", failed: "Wrong currency" },
  price_matches_page: { label: "The agent's price matches the store's page", failed: "Price mismatch" },
  not_cash_equivalent: { label: "Not a gift card or other cash equivalent", failed: "Gift card or cash equivalent" },
  category_allowed: { label: "The product is something you allowed", failed: "Outside allowed categories" },
  per_purchase_limit: { label: "Within the per-purchase limit", failed: "Over per-purchase limit" },
  total_limit: { label: "Within the total budget", failed: "Over total budget" },
  daily_limit: { label: "Within today's limit", failed: "Over daily limit" },
  per_merchant_limit: { label: "Within the per-store limit", failed: "Over per-store limit" },
  purchase_count: { label: "Within the number of purchases allowed", failed: "Purchase count used up" },
  category_classified: { label: "The product category could be checked", failed: "Category could not be checked" },
  page_integrity: { label: "No text aimed at AI agents on the page", failed: "Page targets AI agents" },
  approval_threshold: { label: "Below your ask-me-first amount", failed: "Above ask-me-first amount" },
  other: { label: "Other", failed: "Other reason" },
};
export const checkLabel = (rule: string) => CHECKS[rule]?.label ?? rule.replace(/_/g, " ");
export const checkFailed = (rule: string) => CHECKS[rule]?.failed ?? rule.replace(/_/g, " ");

// ---- Evidence ledger --------------------------------------------------------------------------

export const LEDGER: Record<string, { title: string; tone: Tone }> = {
  "purchase.requested": { title: "The agent asked to buy", tone: "neutral" },
  "purchase.decided": { title: "The gateway checked it against your mandate", tone: "brand" },
  "purchase.approved_by_user": { title: "You approved", tone: "ok" },
  "purchase.declined_by_user": { title: "You declined", tone: "neutral" },
  "payment.captured": { title: "PayPal payment completed", tone: "ok" },
  "payment.authorized": { title: "Money reserved at PayPal, not yet charged", tone: "info" },
  "payment.voided": { title: "Reservation released, nothing charged", tone: "neutral" },
  "payment.failed": { title: "PayPal payment failed", tone: "bad" },
  "problem.reported": { title: "You reported a problem", tone: "warn" },
  "refund.requested": { title: "Refund requested from the store", tone: "info" },
  "refund.completed": { title: "Refund completed", tone: "info" },
  "merchant.declined": { title: "The store declined", tone: "bad" },
  "settlement.offer": { title: "The store made an offer", tone: "warn" },
  "settlement.counter": { title: "Your agent made a counter-offer", tone: "neutral" },
  "settlement.accepted": { title: "Offer accepted", tone: "info" },
  "settlement.declined": { title: "Offer declined", tone: "neutral" },
  "dispute.opened": { title: "PayPal dispute update", tone: "dispute" },
  "dispute.evidence_submitted": { title: "Evidence sent to PayPal", tone: "dispute" },
  "webhook.received": { title: "PayPal notification received", tone: "neutral" },
  "mandate.confirmed": { title: "Mandate confirmed", tone: "brand" },
  "mandate.revoked": { title: "Mandate revoked", tone: "neutral" },
  "paypal.linked": { title: "PayPal linked", tone: "ok" },
  "paypal.signed_in": { title: "Signed in with PayPal on a new browser", tone: "neutral" },
  "agent.paused": { title: "Agent paused", tone: "warn" },
  "agent.resumed": { title: "Agent resumed", tone: "ok" },
  "agent.revoked": { title: "Agent revoked", tone: "bad" },
  "account.frozen": { title: "Spending frozen", tone: "bad" },
  "account.unfrozen": { title: "Spending unfrozen", tone: "ok" },
  "merchant.registered": { title: "Store registered", tone: "neutral" },
  "merchant.verified": { title: "Store proved it owns its website", tone: "ok" },
  "merchant.reviewed": { title: "Operator reviewed a store", tone: "neutral" },
  "merchant.removed": { title: "Operator removed a store", tone: "neutral" },
};
export const ledgerEntry = (type: string) => LEDGER[type] ?? { title: type, tone: "neutral" as Tone };

// ---- Mandates ---------------------------------------------------------------------------------

export const MERCHANT_POLICY: Record<string, string> = {
  verified_only: "Verified stores only",
  allowlist: "Only the stores you named",
  any_registered: "Any store the gateway can pay",
};

/** The gateway pauses an agent by itself after repeated blocked attempts. */
export const isAutoPause = (reason: string | null) => !!reason && reason.startsWith("paused automatically");
