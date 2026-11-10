import { money } from "./ids";
import type { MandateRules } from "./rules";

export type Check = { rule: string; passed: boolean; detail: string; enforcedBy: "code" | "model" };
export type Outcome = "approve" | "needs_approval" | "block";
export type Decision = { outcome: Outcome; reason: string; checks: Check[]; evaluatedAt: string };

export type Classification = {
  /** Does the product fall inside one of the mandate's allowed categories? */
  verdict: "match" | "no_match" | "uncertain";
  /** Set when the product is in an always-blocked category (gift card, crypto, ...). */
  blockedCategory: string | null;
  reason: string;
};

export type PolicyInput = {
  now: Date;
  mandate: { status: "draft" | "active" | "revoked"; rules: MandateRules } | null;
  /** Resolved by the gateway from its own registry, never from the agent. */
  merchant: { name: string; baseUrl: string; verified: boolean; payable: boolean } | null;
  /** Read by the gateway from the merchant's page, never from the agent. */
  product: { name: string; priceCents: number; currency: string } | null;
  quantity: number;
  /** What the agent said the price was. A mismatch means the agent saw something different. */
  agentExpectedPriceCents: number | null;
  spend: { committedCents: number; purchaseCount: number };
  classification: Classification | null;
  paymentMethodLinked: boolean;
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

  if (!add("mandate_active", !!i.mandate && i.mandate.status === "active", i.mandate ? `Mandate is ${i.mandate.status}` : "No mandate"))
    return block("There is no active mandate authorising this agent to spend.");
  const r = i.mandate!.rules;

  if (!add("mandate_not_expired", i.now < new Date(r.expiresAt), `Expires ${r.expiresAt}`))
    return block("The mandate has expired.");

  if (!add("payment_method", i.paymentMethodLinked, i.paymentMethodLinked ? "PayPal linked" : "No PayPal account linked"))
    return block("The user has not linked a PayPal account.");

  if (!add("merchant_registered", !!i.merchant, i.merchant ? `${i.merchant.name} (${i.merchant.baseUrl})` : "Merchant is not in the gateway registry"))
    return block("This store is not a known merchant, so the gateway cannot verify who would be paid.");
  const m = i.merchant!;

  if (r.merchantPolicy === "verified_only") {
    if (!add("merchant_verified", m.verified, m.verified ? `${m.name} is verified` : `${m.name} is not verified`))
      return block(`The mandate allows known merchants only, and ${m.name} is not verified.`);
  } else if (r.merchantPolicy === "allowlist") {
    const host = safeHost(m.baseUrl);
    const ok = r.allowedMerchants.some((a) => {
      const x = a.trim().toLowerCase();
      return x === m.name.toLowerCase() || (!!host && (host === x || host.endsWith(`.${x}`))) || m.baseUrl.toLowerCase().startsWith(x);
    });
    if (!add("merchant_allowlisted", ok, ok ? `${m.name} is on the mandate's list` : `${m.name} is not on the mandate's list`))
      return block(`${m.name} is not one of the merchants named in the mandate.`);
  }
  if (!add("merchant_payable", m.payable, m.payable ? "Payee on file" : "No PayPal payee on file"))
    return block(`${m.name} has no PayPal payee on file.`);

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

  // What the product is. A model answers this, and its answer can only narrow what is allowed.
  const c = i.classification;
  const allowedText = r.allowedCategories.join(", ").toLowerCase();
  const hardBlocked = !!c?.blockedCategory && !allowedText.includes(c.blockedCategory.replace(/s$/, ""));
  if (c) {
    if (!add("not_cash_equivalent", !hardBlocked, hardBlocked ? `Product is in a blocked category: ${c.blockedCategory}` : "Not a cash-equivalent product", "model"))
      return block(`"${p.name}" is in a blocked category (${c.blockedCategory}). Cash-equivalent purchases are blocked unless the mandate names them.`);
    if (!add("category_allowed", c.verdict !== "no_match", `${c.verdict}: ${c.reason}`, "model"))
      return block(`"${p.name}" is outside what the mandate allows (${r.allowedCategories.join(", ")}).`);
  }

  // Limits are always checked, whatever the model said or failed to say.
  if (r.perPurchaseLimitCents !== null &&
      !add("per_purchase_limit", total <= r.perPurchaseLimitCents, `${money(total, p.currency)} against a ${money(r.perPurchaseLimitCents, p.currency)} per-purchase limit`))
    return block(`${money(total, p.currency)} is over the ${money(r.perPurchaseLimitCents, p.currency)} per-purchase limit.`);

  const remaining = r.totalLimitCents - i.spend.committedCents;
  if (!add("total_limit", total <= remaining, `${money(total, p.currency)} against ${money(Math.max(remaining, 0), p.currency)} remaining of ${money(r.totalLimitCents, p.currency)}`))
    return block(`${money(total, p.currency)} is more than the ${money(Math.max(remaining, 0), p.currency)} left on this mandate.`);

  if (r.maxPurchases !== null &&
      !add("purchase_count", i.spend.purchaseCount < r.maxPurchases, `${i.spend.purchaseCount} of ${r.maxPurchases} purchases used`))
    return block(`The mandate allows ${r.maxPurchases} purchase(s) and they have been used.`);

  if (!add("category_classified", !!c, c ? c.reason : "Classifier unavailable", "model"))
    return done("needs_approval", "The gateway could not check the product category, so the user must approve this purchase.");
  if (c!.verdict === "uncertain")
    return done("needs_approval", `It is unclear whether "${p.name}" counts as ${r.allowedCategories.join(" or ")}, so the user must approve.`);

  if (r.approvalThresholdCents !== null &&
      !add("approval_threshold", total <= r.approvalThresholdCents, `${money(total, p.currency)} against an ask-above threshold of ${money(r.approvalThresholdCents, p.currency)}`))
    return done("needs_approval", `${money(total, p.currency)} is above the ${money(r.approvalThresholdCents, p.currency)} approval threshold.`);

  return done("approve", `Within the mandate: ${money(total, p.currency)} at ${m.name}.`);
}

function safeHost(u: string) {
  try { return new URL(u).hostname.toLowerCase(); } catch { return null; }
}
