import { describe, expect, it } from "vitest";
import { compare, type StoreStatement } from "../src/lib/assess";

const order = { sku: "STR-TEMPO3", name: "Tempo 3 Road Running Shoe", amountCents: 8900, currency: "USD", merchant: "Stride Running Co.", paidAt: "2026-11-11T10:00:00Z",
  mandateName: "Running shoes", agentName: "Claude Desktop", approvedByUser: false, chargedOnShipment: false };
const store = (o: Partial<StoreStatement> = {}): StoreStatement => ({ status: "shipped", orderedSku: "STR-TEMPO3", shippedSku: "STR-TEMPO3", tracking: "STR123", replacementSent: false, ...o });
const first = (a: ReturnType<typeof compare>) => a.next[0].action;

describe("comparing a complaint with both records", () => {
  it("wrong item: the store's record shows a different item shipped, so the buyer is refunded", () => {
    const a = compare("wrong_item", order, store({ shippedSku: "STR-CARBON" }));
    expect(a.favours).toBe("buyer"); expect(first(a)).toBe("refund");
    expect(a.facts.find((f) => f.what === "What was shipped")?.agree).toBe(false);
  });
  it("wrong item: both records say the right item shipped, so it goes to settlement", () => {
    const a = compare("wrong_item", order, store());
    expect(a.favours).toBe("unclear"); expect(first(a)).toBe("settle");
  });
  it("not received: an unshipped order is refunded", () => {
    const a = compare("not_received", order, store({ status: "paid", shippedSku: null, tracking: null }));
    expect(a.favours).toBe("buyer"); expect(first(a)).toBe("refund");
  });
  it("not received: a tracking number supports the store, and the buyer is told to check it first", () => {
    const a = compare("not_received", order, store());
    expect(a.favours).toBe("store"); expect(first(a)).toBe("wait"); expect(a.why).toContain("STR123");
  });
  it("not received: shipped without tracking settles nothing", () =>
    expect(compare("not_received", order, store({ tracking: null })).favours).toBe("unclear"));
  it("wrong item or damaged on an order the store has not shipped: says so instead of claiming it shipped", () => {
    for (const c of ["wrong_item", "damaged"] as const) {
      const a = compare(c, order, store({ status: "paid", shippedSku: null, tracking: null }));
      expect(a.favours).toBe("unclear"); expect(a.headline).toMatch(/nothing has shipped/); expect(first(a)).toBe("settle");
    }
  });
  it("damaged: neither record can show it, so it goes to settlement", () => {
    const a = compare("damaged", order, store());
    expect(a.favours).toBe("unclear"); expect(first(a)).toBe("settle");
  });
  it("unauthorised: the mandate and agent on record support the store, and the buyer is told to secure the account", () => {
    const a = compare("unauthorised", order, store());
    expect(a.favours).toBe("store"); expect(first(a)).toBe("secure"); expect(a.why).toContain("Running shoes");
  });
  it("an order the store already refunded is reported as such, whatever the complaint", () =>
    expect(compare("damaged", order, store({ status: "refunded" })).headline).toMatch(/already refunded/));
  it("a store that gives no statement leaves it unclear and says so", () => {
    const a = compare("wrong_item", order, null);
    expect(a.favours).toBe("unclear"); expect(a.storeAnswered).toBe(false); expect(a.facts.every((f) => f.agree === null)).toBe(true);
  });
  it("the buyer can always still go to PayPal", () => {
    for (const c of ["not_received", "wrong_item", "damaged", "unauthorised"] as const)
      for (const s of [store(), store({ shippedSku: "STR-CARBON" }), store({ status: "paid", shippedSku: null, tracking: null }), null])
        expect(compare(c, order, s).next.some((n) => n.action === "paypal")).toBe(true);
  });
  it("never promises a refund when the records do not show the store at fault", () => {
    for (const c of ["damaged", "unauthorised"] as const) expect(compare(c, order, store()).next.some((n) => n.action === "refund")).toBe(false);
  });
});
