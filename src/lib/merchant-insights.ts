// What agent commerce is doing for one store, from the gateway's own records.
// Everything returned here is an aggregate: no buyer ids, emails, agent keys, mandate text or request text.
import { and, eq, inArray, isNotNull, isNull, like, or } from "drizzle-orm";
import { db, schema } from "./db";

// ---- Inputs to the pure aggregation -----------------------------------------------------------

/** One agent request for a product at this store. Ids are used only to count distinct agents and buyers. */
export type InsightPurchase = {
  id: string;
  status: string;
  amountCents: number;
  refundedCents: number;
  currency: string;
  createdAt: Date;
  agentId: string;
  userId: string;
  productUrl: string;
  product: { name?: string | null; sku?: string | null } | null;
  /** The policy checks of the gateway's decision, in the order they ran. */
  checks: { rule: string; passed: boolean }[];
};
/** A problem a buyer reported about one of this store's orders. */
export type InsightCase = { purchaseId: string; status: string; decision: string | null; issue: string | null; hasDispute: boolean };
/** A PayPal dispute webhook the gateway recorded for one of this store's orders. */
export type InsightDispute = { purchaseId: string; event: string; outcome: string | null };
export type InsightMerchant = { id: string; name: string; standing: "pending" | "registered" | "verified"; payable: boolean };

// ---- Output -----------------------------------------------------------------------------------

/** Who can do something about a blocked request: the store, or only the buyer (their rules, their agent, their account). */
export type LostSide = "store" | "buyer";
export type LostDemand = { rule: string; label: string; side: LostSide; count: number; valueCents: number };
export type ProductLine = { key: string; name: string; paidOrders: number; revenueCents: number; blockedRequests: number; blockedCents: number };
export type InsightDay = { day: string; paidOrders: number; revenueCents: number; blockedRequests: number };
export type Suggestion = { id: string; tone: "ok" | "warn" | "bad" | "info"; title: string; detail: string };

export type MerchantInsights = {
  merchant: InsightMerchant;
  currency: string;
  requests: {
    total: number;
    /** Orders the buyer was charged for, including ones refunded later. */
    paid: number;
    /** Money reserved on the buyer's account, to be charged when the store ships. */
    reserved: number;
    waitingApproval: number;
    blocked: number;
    /** The buyer was asked and said no. */
    declined: number;
    /** Payment failed, the buyer cancelled before shipment, or the payment is still in flight. */
    other: number;
  };
  revenue: {
    /** Everything charged for paid orders, before refunds. */
    grossCents: number;
    refundedCents: number;
    /** Gross minus refunds. */
    netCents: number;
    reservedCents: number;
    waitingApprovalCents: number;
    /** Gross divided by paid orders. */
    averageOrderCents: number;
  };
  /** The last 14 UTC days, oldest first. */
  daily: InsightDay[];
  lost: { count: number; valueCents: number; byRule: LostDemand[] };
  topPaid: ProductLine[];
  topBlocked: ProductLine[];
  afterSale: {
    problems: number;
    fullRefund: number;
    partialRefund: number;
    replacement: number;
    declined: number;
    /** Still being worked out, including offers waiting for the buyer. */
    open: number;
    /** What buyers reported, by kind (for example wrong_item), most common first. */
    issues: { issue: string; count: number }[];
    disputes: { opened: number; won: number; lost: number; open: number };
  };
  distinctAgents: number;
  distinctBuyers: number;
  suggestions: Suggestion[];
};

// ---- Wording ----------------------------------------------------------------------------------

/** Why a request was blocked, said to the store, and whether the store can change it. */
const RULES: Record<string, { label: string; side: LostSide }> = {
  merchant_registered: { label: "The store was not registered with the gateway", side: "store" },
  merchant_verified: { label: "The store is not verified", side: "store" },
  merchant_payable: { label: "The store had no confirmed PayPal payee", side: "store" },
  product_readable: { label: "The gateway could not read the product page", side: "store" },
  price_matches_page: { label: "The price on the page differed from the price the agent saw", side: "store" },
  currency_matches: { label: "The page's currency differed from the buyer's currency", side: "store" },
  page_integrity: { label: "The product page had text aimed at AI agents", side: "store" },
  merchant_allowlisted: { label: "The buyer's rules name other stores", side: "buyer" },
  merchant_not_blocked: { label: "The buyer's rules exclude this store", side: "buyer" },
  not_cash_equivalent: { label: "Gift cards and cash equivalents are not allowed", side: "buyer" },
  category_allowed: { label: "The product was outside what the buyer allowed", side: "buyer" },
  category_classified: { label: "The product's category could not be checked", side: "buyer" },
  per_purchase_limit: { label: "Over the buyer's limit for one purchase", side: "buyer" },
  total_limit: { label: "Over the buyer's total budget", side: "buyer" },
  daily_limit: { label: "Over the buyer's daily limit", side: "buyer" },
  per_merchant_limit: { label: "Over the buyer's limit for one store", side: "buyer" },
  purchase_count: { label: "The buyer's number of purchases was used up", side: "buyer" },
  quantity_valid: { label: "The agent asked for an invalid quantity", side: "buyer" },
  account_not_frozen: { label: "The buyer had frozen all agent spending", side: "buyer" },
  agent_active: { label: "The buyer's agent was paused", side: "buyer" },
  rate_limit: { label: "The agent sent too many requests", side: "buyer" },
  mandate_active: { label: "The buyer had no active mandate", side: "buyer" },
  mandate_not_expired: { label: "The buyer's mandate had expired", side: "buyer" },
  payment_method: { label: "The buyer had not linked PayPal", side: "buyer" },
};
const ruleInfo = (rule: string) => RULES[rule] ?? { label: rule === "other" ? "Other reason" : `Failed check: ${rule.replace(/_/g, " ")}`, side: "buyer" as LostSide };

const ISSUES: Record<string, string> = { wrong_item: "the wrong item arrived", not_as_described: "the item was not as described", damaged: "the item arrived damaged", not_received: "the item did not arrive", changed_mind: "the buyer changed their mind" };

const usd = (cents: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const worth = (cents: number, currency: string) => (cents > 0 ? ` worth ${usd(cents, currency)}` : "");

// ---- Aggregation ------------------------------------------------------------------------------

/** The buyer was charged for these, whatever happened afterwards. */
const PAID = new Set(["captured", "refund_requested", "refunded", "partially_refunded", "disputed"]);
const OPEN_CASE = new Set(["open", "refund_requested", "offer_pending"]);
const DAYS = 14;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** The first check that failed, which is the reason the gateway gave for blocking. */
export const failedRule = (checks: { rule: string; passed: boolean }[] | null | undefined) => checks?.find((c) => !c.passed)?.rule ?? "other";

/** What was refunded on a purchase. A fully refunded purchase counts in full even when the amount was not recorded (a dispute decided for the buyer). */
const refundedOn = (p: InsightPurchase) => (p.status === "refunded" ? p.amountCents : Math.min(Math.max(p.refundedCents, 0), p.amountCents));

/**
 * Turn a store's rows into the numbers shown to its owner. Pure: no database, no clock other than `now`.
 * Money is summed as stored; the currency reported is the one most rows use.
 */
export function aggregateInsights(merchant: InsightMerchant, purchases: InsightPurchase[], cases: InsightCase[], disputes: InsightDispute[] = [], now: Date = new Date()): MerchantInsights {
  const currencies = new Map<string, number>();
  for (const p of purchases) currencies.set(p.currency, (currencies.get(p.currency) ?? 0) + 1);
  const currency = [...currencies].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";

  const requests = { total: purchases.length, paid: 0, reserved: 0, waitingApproval: 0, blocked: 0, declined: 0, other: 0 };
  const revenue = { grossCents: 0, refundedCents: 0, netCents: 0, reservedCents: 0, waitingApprovalCents: 0, averageOrderCents: 0 };
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daily: InsightDay[] = Array.from({ length: DAYS }, (_, i) => ({ day: dayOf(new Date(today.getTime() - (DAYS - 1 - i) * 86_400_000)), paidOrders: 0, revenueCents: 0, blockedRequests: 0 }));
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const lost = new Map<string, LostDemand>();
  const products = new Map<string, ProductLine>();
  const line = (p: InsightPurchase) => {
    const key = p.product?.sku || p.product?.name || p.productUrl;
    let l = products.get(key);
    if (!l) products.set(key, (l = { key, name: p.product?.name || p.product?.sku || "Product page the gateway could not read", paidOrders: 0, revenueCents: 0, blockedRequests: 0, blockedCents: 0 }));
    return l;
  };

  for (const p of purchases) {
    const day = byDay.get(dayOf(p.createdAt));
    if (PAID.has(p.status)) {
      requests.paid++; revenue.grossCents += p.amountCents; revenue.refundedCents += refundedOn(p);
      const l = line(p); l.paidOrders++; l.revenueCents += p.amountCents;
      if (day) { day.paidOrders++; day.revenueCents += p.amountCents; }
    } else if (p.status === "authorized") { requests.reserved++; revenue.reservedCents += p.amountCents; }
    else if (p.status === "pending_approval") { requests.waitingApproval++; revenue.waitingApprovalCents += p.amountCents; }
    else if (p.status === "declined") requests.declined++;
    else if (p.status === "blocked") {
      requests.blocked++;
      const rule = failedRule(p.checks);
      const g = lost.get(rule) ?? { rule, ...ruleInfo(rule), count: 0, valueCents: 0 };
      g.count++; g.valueCents += p.amountCents; lost.set(rule, g);
      const l = line(p); l.blockedRequests++; l.blockedCents += p.amountCents;
      if (day) day.blockedRequests++;
    } else requests.other++;
  }
  revenue.netCents = revenue.grossCents - revenue.refundedCents;
  revenue.averageOrderCents = requests.paid ? Math.round(revenue.grossCents / requests.paid) : 0;

  const byRule = [...lost.values()].sort((a, b) => b.valueCents - a.valueCents || b.count - a.count || a.rule.localeCompare(b.rule));
  const lines = [...products.values()];
  const topPaid = lines.filter((l) => l.paidOrders > 0).sort((a, b) => b.paidOrders - a.paidOrders || b.revenueCents - a.revenueCents || a.name.localeCompare(b.name)).slice(0, 5);
  const topBlocked = lines.filter((l) => l.blockedRequests > 0).sort((a, b) => b.blockedRequests - a.blockedRequests || b.blockedCents - a.blockedCents || a.name.localeCompare(b.name)).slice(0, 5);

  // After the sale.
  const afterSale = { problems: cases.length, fullRefund: 0, partialRefund: 0, replacement: 0, declined: 0, open: 0, issues: [] as { issue: string; count: number }[], disputes: { opened: 0, won: 0, lost: 0, open: 0 } };
  const issues = new Map<string, number>();
  for (const c of cases) {
    if (c.status === "refunded") afterSale.fullRefund++;
    else if (c.status === "settled") { if (c.decision === "replacement") afterSale.replacement++; else afterSale.partialRefund++; }
    else if (c.status === "merchant_declined") afterSale.declined++;
    else if (OPEN_CASE.has(c.status)) afterSale.open++;
    if (c.issue && /^[a-z_]{1,40}$/.test(c.issue)) issues.set(c.issue, (issues.get(c.issue) ?? 0) + 1);
  }
  afterSale.issues = [...issues].map(([issue, count]) => ({ issue, count })).sort((a, b) => b.count - a.count || a.issue.localeCompare(b.issue));

  // Disputes: a purchase is disputed if PayPal told the gateway so, a case carries a dispute id, or it is in dispute now.
  const disputed = new Map<string, "open" | "won" | "lost">();
  for (const p of purchases) if (p.status === "disputed") disputed.set(p.id, "open");
  for (const c of cases) if (c.hasDispute || c.status === "disputed") disputed.set(c.purchaseId, disputed.get(c.purchaseId) ?? "open");
  for (const d of disputes) {
    const resolved = d.event === "CUSTOMER.DISPUTE.RESOLVED";
    const state = !resolved ? "open" : d.outcome?.includes("BUYER") ? "lost" : "won";
    if (state !== "open" || !disputed.has(d.purchaseId)) disputed.set(d.purchaseId, state);
  }
  for (const s of disputed.values()) { afterSale.disputes.opened++; afterSale.disputes[s]++; }

  const out: MerchantInsights = {
    merchant, currency, requests, revenue, daily,
    lost: { count: requests.blocked, valueCents: byRule.reduce((s, g) => s + g.valueCents, 0), byRule },
    topPaid, topBlocked, afterSale,
    distinctAgents: new Set(purchases.map((p) => p.agentId)).size,
    distinctBuyers: new Set(purchases.map((p) => p.userId)).size,
    suggestions: [],
  };
  out.suggestions = suggest(out);
  return out;
}

/** Plain-language next steps, each one backed by a number above. No model is involved. */
export function suggest(i: MerchantInsights): Suggestion[] {
  const out: Suggestion[] = [];
  const cur = i.currency;
  const rule = (r: string) => i.lost.byRule.find((g) => g.rule === r);
  const were = (c: number) => (c === 1 ? "was" : "were");

  const unregistered = rule("merchant_registered");
  if (unregistered && i.merchant.standing === "pending")
    out.push({ id: "register", tone: "bad", title: "Finish registering", detail: `${n(unregistered.count, "request")}${worth(unregistered.valueCents, cur)} ${were(unregistered.count)} blocked because the store has not proved it owns its site. Publish the ownership file to become payable.` });

  const payee = rule("merchant_payable");
  if (payee && !i.merchant.payable)
    out.push({ id: "payee", tone: "bad", title: "Add a PayPal payee", detail: `${n(payee.count, "request")}${worth(payee.valueCents, cur)} ${were(payee.count)} blocked because the gateway has no confirmed PayPal account to pay. Name one in the file your store publishes.` });

  const unverified = rule("merchant_verified");
  if (unverified && i.merchant.standing !== "verified")
    out.push({ id: "verify", tone: "warn", title: "Get verified", detail: `${n(unverified.count, "request")}${worth(unverified.valueCents, cur)} ${were(unverified.count)} blocked only because the store is not verified. Verification is granted by the gateway's operator after a review.` });

  const price = rule("price_matches_page");
  if (price)
    out.push({ id: "price", tone: "warn", title: "Fix your product data", detail: `${n(price.count, "request")}${worth(price.valueCents, cur)} ${were(price.count)} blocked because the price on the page differed from the price the agent saw. Check that your catalogue, search results and product pages show the same price.` });

  const unreadable = rule("product_readable");
  if (unreadable)
    out.push({ id: "readable", tone: "warn", title: "Make product pages readable", detail: `${n(unreadable.count, "request")} ${were(unreadable.count)} blocked because the gateway could not read the product, price and currency from the page. Publish schema.org Product data on each product page.` });

  const integrity = rule("page_integrity");
  if (integrity)
    out.push({ id: "integrity", tone: "bad", title: "Remove text aimed at AI agents", detail: `${n(integrity.count, "request")} ${were(integrity.count)} blocked because the product page had instructions for agents or text hidden from shoppers.` });

  const currency = rule("currency_matches");
  if (currency)
    out.push({ id: "currency", tone: "info", title: "Check your currency", detail: `${n(currency.count, "request")} ${were(currency.count)} blocked because the page's currency differed from the currency of the buyer's rules.` });

  const { problems, issues } = i.afterSale;
  if (problems >= 3 && i.requests.paid > 0 && problems / i.requests.paid >= 0.2) {
    const top = issues[0];
    out.push({ id: "problems", tone: "warn", title: "Look at reported problems", detail: `Buyers reported a problem on ${problems} of ${n(i.requests.paid, "paid order")}.${top ? ` The most common report (${top.count} of ${problems}): ${ISSUES[top.issue] ?? top.issue.replace(/_/g, " ")}.` : ""}` });
  }

  if (i.afterSale.disputes.lost > 0)
    out.push({ id: "disputes", tone: "warn", title: "Review lost disputes", detail: `PayPal decided ${n(i.afterSale.disputes.lost, "dispute")} for the buyer. Answer each dispute with the signed order record and a tracking number.` });

  if (i.requests.reserved > 0)
    out.push({ id: "ship", tone: "info", title: "Ship reserved orders", detail: `${n(i.requests.reserved, "order")} worth ${usd(i.revenue.reservedCents, cur)} ${i.requests.reserved === 1 ? "is" : "are"} reserved and will be charged when you report the shipment.` });

  return out;
}

// ---- Loading ----------------------------------------------------------------------------------

const { merchants, purchases, cases, ledger } = schema;
type MerchantRow = typeof merchants.$inferSelect;
const str = (v: unknown) => (typeof v === "string" ? v : null);

async function load(m: MerchantRow): Promise<MerchantInsights> {
  const standing = m.verified ? "verified" : m.source === "builtin" || m.domainVerifiedAt ? "registered" : "pending";
  const payable = (m.source === "builtin" || !!m.domainVerifiedAt) && !!(m.paypalMerchantId || m.paypalEmail);
  // Requests made before the store registered have no merchant on them; they are matched by the product's address.
  const escaped = m.baseUrl.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await db.select({
    id: purchases.id, status: purchases.status, amountCents: purchases.amountCents, refundedCents: purchases.refundedCents, currency: purchases.currency, createdAt: purchases.createdAt,
    agentId: purchases.agentId, userId: purchases.userId, productUrl: purchases.productUrl, product: purchases.product, decision: purchases.decision,
  }).from(purchases).where(or(eq(purchases.merchantId, m.id), and(isNull(purchases.merchantId), like(purchases.productUrl, `${escaped}/%`))));
  const ids = rows.map((r) => r.id);
  const [caseRows, disputeRows] = ids.length === 0 ? [[], []] : await Promise.all([
    db.select({ purchaseId: cases.purchaseId, status: cases.status, analysis: cases.analysis, merchantResponse: cases.merchantResponse, paypalDisputeId: cases.paypalDisputeId }).from(cases).where(inArray(cases.purchaseId, ids)),
    db.select({ purchaseId: ledger.purchaseId, payload: ledger.payload }).from(ledger).where(and(eq(ledger.type, "dispute.opened"), isNotNull(ledger.purchaseId), inArray(ledger.purchaseId, ids))),
  ]);
  return aggregateInsights(
    { id: m.id, name: m.name, standing, payable },
    rows.map((r) => ({ id: r.id, status: r.status, amountCents: r.amountCents, refundedCents: r.refundedCents, currency: r.currency, createdAt: r.createdAt, agentId: r.agentId, userId: r.userId, productUrl: r.productUrl,
      product: r.product ? { name: r.product.name, sku: r.product.sku } : null, checks: (r.decision?.checks ?? []).map((c) => ({ rule: c.rule, passed: c.passed })) })),
    caseRows.map((c) => ({ purchaseId: c.purchaseId, status: c.status, decision: str(c.merchantResponse?.decision), issue: str(c.analysis?.issue), hasDispute: !!c.paypalDisputeId })),
    disputeRows.map((d) => ({ purchaseId: d.purchaseId!, event: str(d.payload.event) ?? "", outcome: str(d.payload.outcome) })),
  );
}

/** Aggregated numbers for one store. The caller decides who may see them. */
export async function merchantInsights(merchantId: string): Promise<MerchantInsights | null> {
  const [m] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
  return m ? load(m) : null;
}

/**
 * Insights for the stores this user registered and has proved they own, keyed by merchant id.
 * A store registered by anyone else is never included, and neither is one whose ownership is not proved yet.
 */
export async function insightsForRegistrant(userId: string): Promise<Record<string, MerchantInsights>> {
  if (!userId) return {};
  const mine = await db.select().from(merchants).where(and(eq(merchants.registeredBy, userId), isNotNull(merchants.domainVerifiedAt)));
  return Object.fromEntries(await Promise.all(mine.map(async (m) => [m.id, await load(m)] as const)));
}
