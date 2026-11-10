// Make one real, paid and correctly shipped order, ready for a buyer to dispute in PayPal's sandbox Resolution Center.
// Usage: E2E_VAULT_ID=<vault id> DATABASE_URL=<db> APP_URL=<host> tsx --env-file=.env.local scripts/seed-dispute-order.ts
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { confirmMandate, createAgent, requestPurchase } from "../src/lib/gateway";
import { newId } from "../src/lib/ids";
import { shipOrder } from "../src/lib/stores/merchant";

async function main() {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  if (!process.env.E2E_VAULT_ID) throw new Error("E2E_VAULT_ID is required");
  const userId = newId("usr_dispute");
  await db.insert(schema.users).values({ id: userId });
  await db.insert(schema.paypalLinks).values({ userId, vaultId: process.env.E2E_VAULT_ID, status: "active", payerEmail: "sandbox buyer" });
  await confirmMandate(userId, "Up to $150 on running shoes, known merchants only, ask me above $100.", {
    summary: "Up to $150 on running shoes from verified merchants; ask above $100.", currency: "USD", totalLimitCents: 15000, perPurchaseLimitCents: null,
    approvalThresholdCents: 10000, allowedCategories: ["running shoes"], merchantPolicy: "verified_only", allowedMerchants: [], maxPurchases: null,
    expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
  });
  const { agent } = await createAgent(userId, "Dispute demo agent");
  const p = await requestPurchase(agent, {
    productUrl: base + "/stores/stride/products/STR-CLOUD", quantity: 1, expectedPriceCents: 7900,
    userRequest: "Buy me a comfortable everyday running shoe under $100", reason: "Cloudline Daily Trainer, $79, wide toe box",
  });
  console.log("purchase", p.id, p.status, "order", p.paypalOrderId, "capture", p.paypalCaptureId);
  if (p.status !== "captured") { console.log(JSON.stringify(p.decision)); process.exit(1); }
  let order: typeof schema.storeOrders.$inferSelect | undefined;
  for (let i = 0; i < 20 && !order; i++) {
    [order] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.gatewayPurchaseId, p.id));
    if (!order) await new Promise((r) => setTimeout(r, 500));
  }
  if (!order) throw new Error("The store did not record the order");
  const shipped = await shipOrder("stride", order.id, order.sku);
  console.log("store order", order.id, "shipped", shipped?.shippedSku, "tracking", shipped?.tracking);
  process.exit(0);
}
main().catch((e) => { console.error(String(e)); process.exit(1); });
