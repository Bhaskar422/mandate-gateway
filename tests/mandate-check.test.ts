import { describe, expect, it } from "vitest";
import { amountsIn, MAX_TOTAL_CENTS, reviewDraft } from "../src/lib/mandate-check";
import type { MandateRules } from "../src/lib/rules";

const NOW = new Date("2026-11-11T00:00:00Z");
const rules = (o: Partial<MandateRules> = {}): MandateRules => ({
  summary: "s", currency: "USD", totalLimitCents: 15000, perPurchaseLimitCents: null, dailyLimitCents: null, perMerchantLimitCents: null, approvalThresholdCents: null,
  allowedCategories: ["running shoes"], merchantPolicy: "verified_only", allowedMerchants: [], blockedMerchants: [], maxPurchases: null, expiresAt: "2026-11-18T00:00:00Z", ...o,
});
const review = (text: string, o: Partial<MandateRules> = {}) => reviewDraft(text, rules(o), NOW);
const ids = (r: ReturnType<typeof review>) => r.questions.map((q) => q.id);

describe("reading amounts from the user's words", () => {
  it("finds symbols, words, thousands separators and k", () =>
    expect(amountsIn("Up to $1,200 or 150 dollars, maybe 80 usd, €40.50 and $2k")).toEqual([120000, 4050, 200000, 15000, 8000]));
  it("ignores numbers that are not money", () => expect(amountsIn("at most 2 purchases over 7 days")).toEqual([]));
});

describe("a clear mandate", () => {
  it("passes untouched", () => {
    const r = review("Up to $150 on running shoes, known merchants only, ask me above $100.", { approvalThresholdCents: 10000 });
    expect(r.questions).toEqual([]); expect(r.changes).toEqual([]); expect(r.rules.totalLimitCents).toBe(15000); expect(r.rules.approvalThresholdCents).toBe(10000);
  });
});

describe("questions the user must answer", () => {
  it("asks for a budget when no amount was written", () => expect(ids(review("Get me whatever running gear I need", { totalLimitCents: 5000 }))).toContain("amount"));
  it("accepts a budget written without a known currency word when the draft total is a number the user wrote", () =>
    expect(ids(review("Hasta 120 dólares en zapatillas para correr", { totalLimitCents: 12000 }))).not.toContain("amount"));
  it("asks which currency when two are mentioned", () => expect(ids(review("Up to 150 euros or dollars on shoes"))).toContain("currency"));
  it("asks what may be bought when the draft has no real category", () => {
    const r = review("Up to $50 total", { totalLimitCents: 5000, allowedCategories: ["unspecified - please confirm"] });
    expect(ids(r)).toContain("category");
  });
  it("asks again when the budget is under a dollar", () => expect(ids(review("Spend $0 on anything", { totalLimitCents: 1, allowedCategories: ["anything"] }))).toContain("amount-small"));
  it("asks which stores when a named-stores mandate names none the user wrote", () => {
    const r = review("Up to $80 on coffee", { totalLimitCents: 8000, allowedCategories: ["coffee"], merchantPolicy: "allowlist", allowedMerchants: ["Tidewater Coffee Roasters"] });
    expect(ids(r)).toContain("stores"); expect(r.rules.allowedMerchants).toEqual([]);
  });
});

describe("narrowing a draft the model made too wide", () => {
  it("reverts 'any store' when the user did not say it", () => {
    const r = review("Up to $50 on socks", { totalLimitCents: 5000, allowedCategories: ["socks"], merchantPolicy: "any_registered" });
    expect(r.rules.merchantPolicy).toBe("verified_only"); expect(r.changes.join(" ")).toMatch(/any store/);
  });
  it("keeps 'any store' when the user said it", () =>
    expect(review("Up to $50 on socks from any store", { totalLimitCents: 5000, allowedCategories: ["socks"], merchantPolicy: "any_registered" }).rules.merchantPolicy).toBe("any_registered"));
  it("removes gift cards the user never mentioned", () => {
    const r = review("Up to $100 on running shoes", { totalLimitCents: 10000, allowedCategories: ["running shoes", "gift cards"] });
    expect(r.rules.allowedCategories).toEqual(["running shoes"]);
  });
  it("keeps gift cards the user asked for by name", () =>
    expect(review("Up to $100 on gift cards from Stride", { totalLimitCents: 10000, allowedCategories: ["gift cards"], merchantPolicy: "allowlist", allowedMerchants: ["Stride"] }).rules.allowedCategories).toEqual(["gift cards"]));
  it("drops 'anything' unless the user said anything", () => {
    expect(ids(review("Up to $50 on socks", { totalLimitCents: 5000, allowedCategories: ["anything"] }))).toContain("category");
    expect(review("Buy anything, up to $50", { totalLimitCents: 5000, allowedCategories: ["anything"] }).rules.allowedCategories).toEqual(["anything"]);
  });
  it("caps the budget at the gateway maximum", () =>
    expect(review("Up to $9,000,000 on shoes", { totalLimitCents: 900_000_000 }).rules.totalLimitCents).toBe(MAX_TOTAL_CENTS));
  it("flags a total larger than anything the user wrote, without changing it", () => {
    const r = review("Up to $50 on socks", { totalLimitCents: 99_999, allowedCategories: ["socks"] });
    expect(r.rules.totalLimitCents).toBe(99_999); expect(r.changes.join(" ")).toMatch(/more than the largest amount you wrote/);
  });
  it("lowers per-purchase, daily and per-store limits to the total", () => {
    const r = review("Up to $50 total, $200 per purchase", { totalLimitCents: 5000, perPurchaseLimitCents: 20000, dailyLimitCents: 9000, perMerchantLimitCents: 7000 });
    expect([r.rules.perPurchaseLimitCents, r.rules.dailyLimitCents, r.rules.perMerchantLimitCents]).toEqual([5000, 5000, 5000]);
  });
  it("removes an ask-first amount that could never be reached", () =>
    expect(review("Up to $50, ask me above $300", { totalLimitCents: 5000, approvalThresholdCents: 30000 }).rules.approvalThresholdCents).toBe(0));
  it("asks every time when the user said 'ask me' and the draft forgot", () =>
    expect(review("Up to $150 on running shoes, ask me first", {}).rules.approvalThresholdCents).toBe(0));
  it("does not add asking when the user said never to ask", () =>
    expect(review("Up to $150 on running shoes, don't ask me", {}).rules.approvalThresholdCents).toBeNull());
  it("limits how long a mandate lasts and repairs a past end date", () => {
    expect(new Date(review("Up to $150 on shoes forever", { expiresAt: "2030-01-01T00:00:00Z" }).rules.expiresAt).getTime()).toBe(NOW.getTime() + 90 * 864e5);
    expect(new Date(review("Up to $150 on shoes", { expiresAt: "2020-01-01T00:00:00Z" }).rules.expiresAt).getTime()).toBe(NOW.getTime() + 7 * 864e5);
  });
  it("never widens: every numeric limit is at most the draft's", () => {
    const d = rules({ totalLimitCents: 20000, perPurchaseLimitCents: 5000, dailyLimitCents: 8000 });
    const r = reviewDraft("Up to $200 on running shoes, $50 per purchase, $80 a day", d, NOW).rules;
    expect(r.totalLimitCents).toBeLessThanOrEqual(d.totalLimitCents); expect(r.perPurchaseLimitCents).toBeLessThanOrEqual(d.perPurchaseLimitCents!); expect(r.dailyLimitCents).toBeLessThanOrEqual(d.dailyLimitCents!);
  });
});
