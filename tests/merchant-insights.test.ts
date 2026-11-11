import { describe, expect, it } from "vitest";
import { aggregateInsights, failedRule, type InsightCase, type InsightMerchant, type InsightPurchase } from "../src/lib/merchant-insights";

const now = new Date("2026-11-11T12:00:00Z");
const store: InsightMerchant = { id: "mer_1", name: "Stride", standing: "registered", payable: true };
const pass = (rule: string) => ({ rule, passed: true });
const fail = (rule: string) => ({ rule, passed: false });
let seq = 0;
const row = (o: Partial<InsightPurchase> = {}): InsightPurchase => ({
  id: `pur_${++seq}`, status: "captured", amountCents: 8900, refundedCents: 0, currency: "USD", createdAt: new Date("2026-11-10T09:00:00Z"),
  agentId: "agt_1", userId: "usr_1", productUrl: "https://stride.example/p/tempo", product: { name: "Tempo 3", sku: "STR-TEMPO3" }, checks: [pass("merchant_registered")], ...o,
});
const blocked = (rule: string, o: Partial<InsightPurchase> = {}) => row({ status: "blocked", checks: [pass("merchant_registered"), fail(rule), fail("total_limit")], ...o });
const run = (purchases: InsightPurchase[], cases: InsightCase[] = [], merchant = store) => aggregateInsights(merchant, purchases, cases, [], now);

describe("merchant insights", () => {
  it("returns zeros and no suggestions for a store with no agent traffic", () => {
    const i = run([]);
    expect(i.requests).toEqual({ total: 0, paid: 0, reserved: 0, waitingApproval: 0, blocked: 0, declined: 0, other: 0 });
    expect(i.revenue.netCents).toBe(0);
    expect(i.daily).toHaveLength(14);
    expect(i.daily[13].day).toBe("2026-11-11");
    expect(i.daily[0].day).toBe("2026-10-29");
    expect(i.suggestions).toEqual([]);
  });

  it("counts requests by what became of them", () => {
    const i = run([row(), row({ status: "authorized", amountCents: 5000 }), row({ status: "pending_approval", amountCents: 13500 }), blocked("total_limit"),
      row({ status: "declined" }), row({ status: "payment_failed" }), row({ status: "cancelled" }), row({ status: "refunded", refundedCents: 8900 })]);
    expect(i.requests).toEqual({ total: 8, paid: 2, reserved: 1, waitingApproval: 1, blocked: 1, declined: 1, other: 2 });
    expect(i.revenue.reservedCents).toBe(5000);
    expect(i.revenue.waitingApprovalCents).toBe(13500);
  });

  it("reports revenue net of refunds and the average paid order", () => {
    const i = run([row({ amountCents: 10000 }), row({ amountCents: 6000, status: "partially_refunded", refundedCents: 1500 }),
      row({ amountCents: 2000, status: "refunded", refundedCents: 0 }), blocked("total_limit", { amountCents: 99900 })]);
    expect(i.revenue.grossCents).toBe(18000);
    expect(i.revenue.refundedCents).toBe(3500); // a fully refunded order counts in full even with no amount recorded
    expect(i.revenue.netCents).toBe(14500);
    expect(i.revenue.averageOrderCents).toBe(6000);
  });

  it("builds a 14-day series and leaves older rows out of it", () => {
    const i = run([row({ createdAt: new Date("2026-11-11T01:00:00Z") }), row({ createdAt: new Date("2026-11-11T23:00:00Z"), amountCents: 1100 }),
      blocked("total_limit", { createdAt: new Date("2026-10-29T00:00:00Z") }), row({ createdAt: new Date("2026-10-28T23:59:00Z") })]);
    expect(i.daily[13]).toEqual({ day: "2026-11-11", paidOrders: 2, revenueCents: 10000, blockedRequests: 0 });
    expect(i.daily[0]).toEqual({ day: "2026-10-29", paidOrders: 0, revenueCents: 0, blockedRequests: 1 });
    expect(i.daily.reduce((s, d) => s + d.paidOrders, 0)).toBe(2);
    expect(i.requests.paid).toBe(3);
  });

  it("groups blocked requests by the first failed check, with their value", () => {
    const i = run([blocked("merchant_verified", { amountCents: 10000 }), blocked("merchant_verified", { amountCents: 5000 }), blocked("price_matches_page", { amountCents: 8900 }),
      blocked("total_limit", { amountCents: 20000 }), row({ status: "blocked", checks: [] })]);
    expect(i.lost.count).toBe(5);
    expect(i.lost.valueCents).toBe(52800);
    expect(i.lost.byRule.map((g) => [g.rule, g.count, g.valueCents, g.side])).toEqual([
      ["total_limit", 1, 20000, "buyer"], ["merchant_verified", 2, 15000, "store"], ["other", 1, 8900, "buyer"], ["price_matches_page", 1, 8900, "store"]]);
    expect(failedRule([pass("a"), fail("b"), fail("c")])).toBe("b");
    expect(failedRule(null)).toBe("other");
  });

  it("ranks products by paid orders and by blocked requests", () => {
    const sock = { product: { name: "Socks", sku: "SOCK" }, amountCents: 1800 };
    const i = run([row(), row(), row(sock), blocked("total_limit", sock), blocked("total_limit", sock), blocked("total_limit"),
      blocked("merchant_registered", { product: null, amountCents: 0, productUrl: "https://stride.example/p/x" })]);
    expect(i.topPaid.map((l) => [l.name, l.paidOrders, l.revenueCents])).toEqual([["Tempo 3", 2, 17800], ["Socks", 1, 1800]]);
    expect(i.topBlocked.map((l) => [l.key, l.blockedRequests, l.blockedCents])).toEqual([["SOCK", 2, 3600], ["STR-TEMPO3", 1, 8900], ["https://stride.example/p/x", 1, 0]]);
  });

  it("counts how problems ended and what was reported", () => {
    const c = (status: string, decision: string | null, issue: string | null = "wrong_item"): InsightCase => ({ purchaseId: "pur_x", status, decision, issue, hasDispute: false });
    const i = run([row()], [c("refunded", "refunded"), c("settled", "refunded", "damaged"), c("settled", "replacement"), c("merchant_declined", "declined"), c("offer_pending", "offer"),
      c("refunded", "refunded", "Free text from a buyer")]);
    const { issues, disputes, ...rest } = i.afterSale;
    expect(rest).toEqual({ problems: 6, fullRefund: 2, partialRefund: 1, replacement: 1, declined: 1, open: 1 });
    expect(issues).toEqual([{ issue: "wrong_item", count: 4 }, { issue: "damaged", count: 1 }]);
    expect(disputes).toEqual({ opened: 0, won: 0, lost: 0, open: 0 });
  });

  it("counts disputes opened, won and lost from PayPal's events", () => {
    const a = row(), b = row(), c = row({ status: "disputed" }), d = row();
    const i = aggregateInsights(store, [a, b, c, d], [{ purchaseId: d.id, status: "disputed", decision: null, issue: null, hasDispute: true }], [
      { purchaseId: a.id, event: "CUSTOMER.DISPUTE.CREATED", outcome: null }, { purchaseId: a.id, event: "CUSTOMER.DISPUTE.RESOLVED", outcome: "RESOLVED_SELLER_FAVOUR" },
      { purchaseId: b.id, event: "CUSTOMER.DISPUTE.RESOLVED", outcome: "RESOLVED_BUYER_FAVOUR" }, { purchaseId: b.id, event: "CUSTOMER.DISPUTE.UPDATED", outcome: null },
    ], now);
    expect(i.afterSale.disputes).toEqual({ opened: 4, won: 1, lost: 1, open: 2 });
    expect(i.suggestions.map((s) => s.id)).toContain("disputes");
  });

  it("counts distinct agents and buyers and returns no identifiers", () => {
    const i = run([row({ agentId: "agt_secret_1", userId: "usr_secret_1" }), row({ agentId: "agt_secret_2", userId: "usr_secret_1" }), blocked("total_limit", { agentId: "agt_secret_1", userId: "usr_secret_2" })]);
    expect(i.distinctAgents).toBe(2);
    expect(i.distinctBuyers).toBe(2);
    expect(JSON.stringify(i)).not.toMatch(/agt_secret|usr_secret|pur_\d/);
  });

  describe("suggestions", () => {
    const ids = (i: ReturnType<typeof run>) => i.suggestions.map((s) => s.id);
    it("says to get verified, with the count and value, when the store is not verified", () => {
      const i = run([blocked("merchant_verified", { amountCents: 50000 }), blocked("merchant_verified", { amountCents: 11200 })]);
      const s = i.suggestions.find((x) => x.id === "verify")!;
      expect(s.title).toBe("Get verified");
      expect(s.detail).toContain("2 requests worth $612.00 were blocked only because the store is not verified");
    });
    it("does not say to get verified once the store is verified", () =>
      expect(ids(run([blocked("merchant_verified")], [], { ...store, standing: "verified" }))).not.toContain("verify"));
    it("uses the singular for one request", () =>
      expect(run([blocked("price_matches_page")]).suggestions[0].detail).toContain("1 request worth $89.00 was blocked because the price on the page differed"));
    it("says nothing about blocks only the buyer can change", () =>
      expect(ids(run([blocked("total_limit"), blocked("category_allowed"), blocked("agent_active"), row()]))).toEqual([]));
    it("flags a missing payee only while the store has none", () => {
      expect(ids(run([blocked("merchant_payable")], [], { ...store, payable: false }))).toEqual(["payee"]);
      expect(ids(run([blocked("merchant_payable")]))).toEqual([]);
    });
    it("flags reported problems only when they are a real share of paid orders", () => {
      const c: InsightCase = { purchaseId: "p", status: "refunded", decision: "refunded", issue: "wrong_item", hasDispute: false };
      const ten = Array.from({ length: 10 }, () => row());
      expect(ids(run(ten, [c, c]))).toEqual([]);
      const i = run(ten, [c, c, c]);
      expect(ids(i)).toEqual(["problems"]);
      expect(i.suggestions[0].detail).toContain("3 of 10 paid orders");
      expect(ids(run(Array.from({ length: 20 }, () => row()), [c, c, c]))).toEqual([]);
    });
    it("reminds the store to ship reserved orders", () =>
      expect(run([row({ status: "authorized", amountCents: 1800 })]).suggestions[0].detail).toContain("1 order worth $18.00 is reserved"));
  });
});
