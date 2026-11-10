import { describe, expect, it } from "vitest";
import { evaluate, type PolicyInput } from "../src/lib/policy";
import type { MandateRules } from "../src/lib/rules";

const rules: MandateRules = {
  summary: "Up to $150 on running shoes, known merchants only, ask above $100",
  currency: "USD", totalLimitCents: 15000, perPurchaseLimitCents: null, approvalThresholdCents: 10000,
  allowedCategories: ["running shoes"], merchantPolicy: "verified_only", allowedMerchants: [], maxPurchases: null,
  expiresAt: "2030-01-01T00:00:00Z",
};
const base = (o: Partial<PolicyInput> = {}): PolicyInput => ({
  now: new Date("2026-11-11T00:00:00Z"),
  mandate: { status: "active", rules },
  merchant: { name: "Stride", baseUrl: "http://localhost:3000/stores/stride", verified: true, payable: true },
  product: { name: "Tempo 3 Running Shoe", priceCents: 8900, currency: "USD" },
  quantity: 1, agentExpectedPriceCents: 8900,
  spend: { committedCents: 0, purchaseCount: 0 },
  classification: { verdict: "match", blockedCategory: null, reason: "running shoe" },
  paymentMethodLinked: true, ...o,
});

describe("policy engine", () => {
  it("approves an in-mandate purchase", () => expect(evaluate(base()).outcome).toBe("approve"));
  it("asks the user above the threshold", () =>
    expect(evaluate(base({ product: { name: "Carbon Racer", priceCents: 14000, currency: "USD" }, agentExpectedPriceCents: 14000 })).outcome).toBe("needs_approval"));
  it("blocks an unverified merchant", () =>
    expect(evaluate(base({ merchant: { name: "Kickz", baseUrl: "http://x", verified: false, payable: true } })).outcome).toBe("block"));
  it("blocks an unregistered merchant", () => expect(evaluate(base({ merchant: null })).outcome).toBe("block"));
  it("blocks over the total limit, counting earlier spend", () =>
    expect(evaluate(base({ spend: { committedCents: 8900, purchaseCount: 1 } })).outcome).toBe("block"));
  it("blocks a gift card even when the classifier is fooled into 'match'", () =>
    expect(evaluate(base({ classification: { verdict: "match", blockedCategory: "gift cards", reason: "x" } })).outcome).toBe("block"));
  it("blocks a product outside the category", () =>
    expect(evaluate(base({ classification: { verdict: "no_match", blockedCategory: null, reason: "a watch" } })).outcome).toBe("block"));
  it("a fooled classifier cannot lift the spending limit", () =>
    expect(evaluate(base({ product: { name: "Shoe", priceCents: 99900, currency: "USD" }, agentExpectedPriceCents: 99900 })).outcome).toBe("block"));
  it("blocks when the agent's price differs from the page", () =>
    expect(evaluate(base({ agentExpectedPriceCents: 4900 })).outcome).toBe("block"));
  it("blocks expired, revoked and missing mandates", () => {
    expect(evaluate(base({ now: new Date("2031-01-01T00:00:00Z") })).outcome).toBe("block");
    expect(evaluate(base({ mandate: { status: "revoked", rules } })).outcome).toBe("block");
    expect(evaluate(base({ mandate: null })).outcome).toBe("block");
  });
  it("falls back to asking the user when the classifier is down or unsure", () => {
    expect(evaluate(base({ classification: null })).outcome).toBe("needs_approval");
    expect(evaluate(base({ classification: { verdict: "uncertain", blockedCategory: null, reason: "?" } })).outcome).toBe("needs_approval");
  });
  it("multiplies by quantity", () => expect(evaluate(base({ quantity: 2 })).outcome).toBe("block"));
});

describe("ordering", () => {
  it("names the gift card, not the budget, when both would block", () => {
    const d = evaluate(base({ spend: { committedCents: 8900, purchaseCount: 1 }, product: { name: "Gift Card $100", priceCents: 10000, currency: "USD" }, agentExpectedPriceCents: 10000,
      classification: { verdict: "no_match", blockedCategory: "gift cards", reason: "gift card" } }));
    expect(d.outcome).toBe("block"); expect(d.reason).toMatch(/gift cards/);
  });
  it("still enforces limits when the classifier is unavailable", () =>
    expect(evaluate(base({ classification: null, spend: { committedCents: 14000, purchaseCount: 1 } })).outcome).toBe("block"));
  it("allows gift cards only when the mandate names them", () =>
    expect(evaluate(base({ mandate: { status: "active", rules: { ...rules, allowedCategories: ["gift cards"] } }, classification: { verdict: "match", blockedCategory: "gift cards", reason: "gift card" } })).outcome).toBe("approve"));
});
