// "What this means": a few made-up purchases run through the real policy engine against a drafted mandate, so the
// user sees the rules behave before confirming them. Nothing here is recorded, fetched or paid.
import { money } from "./ids";
import { evaluate, type Outcome } from "./policy";
import type { MandateRules } from "./rules";

export type MandateExample = { purchase: string; outcome: Outcome; reason: string };

export function mandateExamples(rules: MandateRules, now = new Date()): MandateExample[] {
  const cur = rules.currency, what = rules.allowedCategories[0] ?? "item";
  const named = rules.merchantPolicy === "allowlist" ? rules.allowedMerchants[0] : null;
  const goodStore = { name: named ?? "a verified store", baseUrl: "https://verified-store.example", verified: rules.merchantPolicy !== "allowlist", payable: true, domainVerified: true };
  const run = (purchase: string, priceCents: number, o: { store?: typeof goodStore; inCategory?: boolean; giftCard?: boolean } = {}): MandateExample => {
    const d = evaluate({
      now, mandate: { status: "active", rules }, merchant: o.store ?? goodStore, product: { name: purchase, priceCents, currency: cur }, quantity: 1, agentExpectedPriceCents: priceCents,
      spend: { committedCents: 0, purchaseCount: 0 }, paymentMethodLinked: true,
      classification: { verdict: o.inCategory === false ? "no_match" : "match", blockedCategory: o.giftCard ? "gift cards" : null, reason: "" },
    });
    return { purchase, outcome: d.outcome, reason: d.reason };
  };
  const ceiling = Math.min(rules.totalLimitCents, rules.perPurchaseLimitCents ?? Infinity, rules.dailyLimitCents ?? Infinity, rules.perMerchantLimitCents ?? Infinity);
  const ask = rules.approvalThresholdCents;
  const out: MandateExample[] = [];
  const at = (store: string) => (named ? `at ${store}` : `at ${store}`);

  // Something clearly inside the rules.
  const easy = Math.max(100, Math.round((ask != null && ask > 0 ? Math.min(ask, ceiling) : ceiling) * 0.6 / 100) * 100);
  out.push(run(`${what} for ${money(easy, cur)} ${at(goodStore.name)}`, easy));
  // Just above the ask-first amount, when there is one that can be reached.
  if (ask != null && ask > 0 && ask < ceiling) { const p = Math.min(ceiling, ask + 500); out.push(run(`${what} for ${money(p, cur)} ${at(goodStore.name)}`, p)); }
  // Over the budget.
  out.push(run(`${what} for ${money(rules.totalLimitCents + 2000, cur)} ${at(goodStore.name)}`, rules.totalLimitCents + 2000));
  // A store the mandate does not cover.
  if (rules.merchantPolicy !== "any_registered") out.push(run(`${what} for ${money(easy, cur)} at ${named ? "a store you did not name" : "a store that is not verified"}`, easy,
    { store: { name: named ? "another store" : "an unverified store", baseUrl: "https://other-store.example", verified: false, payable: true, domainVerified: true } }));
  // Something else entirely, and the classic scam payout.
  out.push(run(`something that is not ${what}, for ${money(easy, cur)}`, easy, { inCategory: false }));
  if (!rules.allowedCategories.some((c) => /gift|prepaid|voucher/i.test(c))) out.push(run(`a ${money(Math.min(2500, ceiling), cur)} gift card ${at(goodStore.name)}`, Math.min(2500, ceiling), { giftCard: true, inCategory: false }));
  return out;
}
