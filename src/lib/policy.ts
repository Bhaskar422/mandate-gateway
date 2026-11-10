import { money } from "./ids";
import { describeSignals, type PageSignal } from "./risk";
import type { MandateRules } from "./rules";

export type Check = { rule: string; passed: boolean; detail: string; enforcedBy: "code" | "model" };
export type Outcome = "approve" | "needs_approval" | "block";
export type Decision = { outcome: Outcome; reason: string; checks: Check[]; evaluatedAt: string; mandateId?: string | null };

export type Classification = {
  /** Does the product fall inside one of the mandate's allowed categories? */
  verdict: "match" | "no_match" | "uncertain";
  /** Set when the product is in an always-blocked category (gift card, crypto, ...). */
  blockedCategory: string | null;
  reason: string;
};

export type PolicyInput = {
  now: Date;
  /** The user's kill switch. */
  accountFrozen?: boolean;
  agent?: { paused: boolean; pauseReason: string | null };
  /** Requests this agent made in the last minute, and the most it may make. */
  rate?: { recentRequests: number; limit: number };
  mandate: { status: "draft" | "active" | "revoked"; rules: MandateRules } | null;
  /** Resolved by the gateway from its own registry, never from the agent. */
  merchant: { name: string; baseUrl: string; verified: boolean; payable: boolean; domainVerified?: boolean } | null;
  /** Read by the gateway from the merchant's page, never from the agent. */
  product: { name: string; priceCents: number; currency: string } | null;
  quantity: number;
  /** What the agent said the price was. A mismatch means the agent saw something different. */
  agentExpectedPriceCents: number | null;
  spend: { committedCents: number; purchaseCount: number; todayCents?: number; merchantCents?: number };
  classification: Classification | null;
  paymentMethodLinked: boolean;
  /** Deterministic findings about the page: text aimed at AI agents, text hidden from shoppers. */
  pageSignals?: PageSignal[];
};

/**
 * The whole policy decision. Pure and deterministic: no model output can raise a limit.
 * The only model-derived input is `classification`, and it can only narrow what is allowed.
 */
export function evaluate(i: PolicyInput): Decision {
  const checks: Check[] = [];
  const add = (rule: string, passed: boolean, detail: string, enforcedBy: Check["enforcedBy"] = "code") => {
    checks.push({ rule, passed, detail, enforcedBy });
    return passed;
  };
  const done = (outcome: Outcome, reason: string): Decision => ({ outcome, reason, checks, evaluatedAt: i.now.toISOString() });
  const block = (reason: string) => done("block", reason);

  // ---- Account and agent state ----------------------------------------------------------------
  if (!add("account_not_frozen", !i.accountFrozen, i.accountFrozen ? "The user has frozen all agent spending" : "Spending is not frozen"))
    return block("The user has frozen all agent spending.");
  if (i.agent && !add("agent_active", !i.agent.paused, i.agent.paused ? `Agent is paused: ${i.agent.pauseReason ?? "paused by the user"}` : "Agent is active"))
    return block(`This agent is paused (${i.agent.pauseReason ?? "paused by the user"}). The user must resume it.`);
  if (i.rate && !add("rate_limit", i.rate.recentRequests < i.rate.limit, `${i.rate.recentRequests} requests in the last minute, limit ${i.rate.limit}`))
    return block("Too many purchase requests in a short time. Wait a minute before trying again.");

  // ---- Mandate --------------------------------------------------------------------------------
  if (!add("mandate_active", !!i.mandate && i.mandate.status === "active", i.mandate ? `Mandate is ${i.mandate.status}` : "No mandate"))
    return block("There is no active mandate authorising this agent to spend.");
  const r = i.mandate!.rules;

  if (!add("mandate_not_expired", i.now < new Date(r.expiresAt), `Expires ${r.expiresAt}`))
    return block("The mandate has expired.");

  if (!add("payment_method", i.paymentMethodLinked, i.paymentMethodLinked ? "PayPal linked" : "No PayPal account linked"))
    return block("The user has not linked a PayPal account.");

  // ---- Merchant -------------------------------------------------------------------------------
  if (!add("merchant_registered", !!i.merchant, i.merchant ? `${i.merchant.name} (${i.merchant.baseUrl})` : "Merchant is not in the gateway registry"))
    return block("This store is not a known merchant, so the gateway cannot verify who would be paid.");
  const m = i.merchant!;
  const named = (list: string[]) => {
    const host = safeHost(m.baseUrl);
    return list.some((a) => {
      const x = a.trim().toLowerCase();
      return !!x && (x === m.name.toLowerCase() || (!!host && (host === x || host.endsWith(`.${x}`))) || m.baseUrl.toLowerCase().startsWith(x));
    });
  };

  if ((r.blockedMerchants ?? []).length &&
      !add("merchant_not_blocked", !named(r.blockedMerchants), named(r.blockedMerchants) ? `${m.name} is on the mandate's never-buy list` : `${m.name} is not on the never-buy list`))
    return block(`The mandate says never to buy from ${m.name}.`);

  if (r.merchantPolicy === "verified_only") {
    if (!add("merchant_verified", m.verified, m.verified ? `${m.name} is verified` : `${m.name} is not verified`))
      return block(`The mandate allows known merchants only, and ${m.name} is not verified.`);
  } else if (r.merchantPolicy === "allowlist") {
    const ok = named(r.allowedMerchants);
    if (!add("merchant_allowlisted", ok, ok ? `${m.name} is on the mandate's list` : `${m.name} is not on the mandate's list`))
      return block(`${m.name} is not one of the merchants named in the mandate.`);
  }
  if (!add("merchant_payable", m.payable, m.payable ? "Payee on file" : "No verified PayPal payee on file"))
    return block(`${m.name} has no verified PayPal payee on file.`);

  // ---- Product, read by the gateway -----------------------------------------------------------
  if (!add("product_readable", !!i.product, i.product ? `${i.product.name} at ${money(i.product.priceCents, i.product.currency)}` : "No machine-readable product on the page"))
    return block("The gateway could not read a product and price from that page.");
  const p = i.product!;

  if (!add("quantity_valid", Number.isInteger(i.quantity) && i.quantity >= 1 && i.quantity <= 20, `Quantity ${i.quantity}`))
    return block("Quantity must be a whole number between 1 and 20.");

  if (!add("currency_matches", p.currency === r.currency, `Product in ${p.currency}, mandate in ${r.currency}`))
    return block(`The mandate is in ${r.currency} but this product is priced in ${p.currency}.`);

  const total = p.priceCents * i.quantity;
  const priceOk = i.agentExpectedPriceCents === null || i.agentExpectedPriceCents === p.priceCents;
  if (!add("price_matches_page", priceOk, priceOk ? "Agent's price matches the merchant's page" : `Agent expected ${money(i.agentExpectedPriceCents!, p.currency)}, page says ${money(p.priceCents, p.currency)}`))
    return block("The price the agent saw differs from the price on the merchant's page.");

  // ---- What the product is. A model answers this, and its answer can only narrow what is allowed.
  const c = i.classification;
  const allowedText = r.allowedCategories.join(", ").toLowerCase();
  const hardBlocked = !!c?.blockedCategory && !allowedText.includes(c.blockedCategory.replace(/s$/, ""));
  if (c) {
    if (!add("not_cash_equivalent", !hardBlocked, hardBlocked ? `Product is in a blocked category: ${c.blockedCategory}` : "Not a cash-equivalent product", "model"))
      return block(`"${p.name}" is in a blocked category (${c.blockedCategory}). Cash-equivalent purchases are blocked unless the mandate names them.`);
    if (!add("category_allowed", c.verdict !== "no_match", `${c.verdict}: ${c.reason}`, "model"))
      return block(`"${p.name}" is outside what the mandate allows (${r.allowedCategories.join(", ")}).`);
  }

  // ---- Limits are always checked, whatever the model said or failed to say. --------------------
  if (r.perPurchaseLimitCents !== null &&
      !add("per_purchase_limit", total <= r.perPurchaseLimitCents, `${money(total, p.currency)} against a ${money(r.perPurchaseLimitCents, p.currency)} per-purchase limit`))
    return block(`${money(total, p.currency)} is over the ${money(r.perPurchaseLimitCents, p.currency)} per-purchase limit.`);

  const remaining = r.totalLimitCents - i.spend.committedCents;
  if (!add("total_limit", total <= remaining, `${money(total, p.currency)} against ${money(Math.max(remaining, 0), p.currency)} remaining of ${money(r.totalLimitCents, p.currency)}`))
    return block(`${money(total, p.currency)} is more than the ${money(Math.max(remaining, 0), p.currency)} left on this mandate.`);

  if (r.dailyLimitCents != null) {
    const left = r.dailyLimitCents - (i.spend.todayCents ?? 0);
    if (!add("daily_limit", total <= left, `${money(total, p.currency)} against ${money(Math.max(left, 0), p.currency)} left today of ${money(r.dailyLimitCents, p.currency)}`))
      return block(`${money(total, p.currency)} is more than the ${money(Math.max(left, 0), p.currency)} left of today's ${money(r.dailyLimitCents, p.currency)} limit.`);
  }
  if (r.perMerchantLimitCents != null) {
    const left = r.perMerchantLimitCents - (i.spend.merchantCents ?? 0);
    if (!add("per_merchant_limit", total <= left, `${money(total, p.currency)} against ${money(Math.max(left, 0), p.currency)} left at ${m.name} of ${money(r.perMerchantLimitCents, p.currency)}`))
      return block(`${money(total, p.currency)} is more than the ${money(Math.max(left, 0), p.currency)} left of the ${money(r.perMerchantLimitCents, p.currency)} limit at ${m.name}.`);
  }

  if (r.maxPurchases !== null &&
      !add("purchase_count", i.spend.purchaseCount < r.maxPurchases, `${i.spend.purchaseCount} of ${r.maxPurchases} purchases used`))
    return block(`The mandate allows ${r.maxPurchases} purchase(s) and they have been used.`);

  // ---- Reasons to ask the user. Nothing below can turn into an automatic approval. -------------
  const ask: string[] = [];
  if (!add("category_classified", !!c, c ? c.reason : "Classifier unavailable", "model"))
    ask.push("The gateway could not check the product category, so the user must approve this purchase.");
  else if (c!.verdict === "uncertain")
    ask.push(`It is unclear whether "${p.name}" counts as ${r.allowedCategories.join(" or ")}, so the user must approve.`);

  const injected = (i.pageSignals ?? []).filter((s) => s.kind === "agent_directed_text");
  if (i.pageSignals) {
    if (!add("page_integrity", injected.length === 0, injected.length ? `${describeSignals(i.pageSignals)} "${injected[0].excerpt.slice(0, 140)}"` : "No text aimed at AI agents on the page"))
      ask.push(`${describeSignals(i.pageSignals)} The user must approve this purchase.`);
  }

  if (r.approvalThresholdCents !== null &&
      !add("approval_threshold", total <= r.approvalThresholdCents, `${money(total, p.currency)} against an ask-above threshold of ${money(r.approvalThresholdCents, p.currency)}`))
    ask.push(`${money(total, p.currency)} is above the ${money(r.approvalThresholdCents, p.currency)} approval threshold.`);

  if (ask.length) return done("needs_approval", ask.join(" "));
  return done("approve", `Within the mandate: ${money(total, p.currency)} at ${m.name}.`);
}

/** With several mandates, the purchase goes ahead under the first that allows it; otherwise the nearest miss explains why. */
export function best(decisions: Decision[]): Decision {
  const rank = { approve: 0, needs_approval: 1, block: 2 } as const;
  return [...decisions].sort((a, b) => rank[a.outcome] - rank[b.outcome] || b.checks.filter((c) => c.passed).length - a.checks.filter((c) => c.passed).length)[0];
}

function safeHost(u: string) {
  try { return new URL(u).hostname.toLowerCase(); } catch { return null; }
}
