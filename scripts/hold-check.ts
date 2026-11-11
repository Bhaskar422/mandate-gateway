// Reserve at purchase, charge on shipment, cancel before shipping, and compare each state with PayPal.
// Needs a running server and a linked sandbox wallet: E2E_VAULT_ID=... pnpm exec tsx --env-file=.env.local scripts/hold-check.ts
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { cancelHold, confirmMandate, createAgent, requestPurchase, updateSettings } from "../src/lib/gateway";
import { verifyChain } from "../src/lib/ledger";
import { reconcilePurchase } from "../src/lib/reconcile";
import { shipOrder } from "../src/lib/stores/merchant";
import { newId } from "../src/lib/ids";
const BASE = process.env.APP_URL ?? "http://localhost:3000";
async function main() {
  const userId = `usr_hold_${newId("x").slice(2)}${newId("y").slice(2)}`;
  await db.insert(schema.users).values({ id: userId });
  await db.insert(schema.paypalLinks).values({ userId, vaultId: process.env.E2E_VAULT_ID!, status: "active", payerEmail: "hold-test@example.com" });
  await updateSettings(userId, { chargeOnShipment: true });
  await confirmMandate(userId, "Up to $200 on running shoes and socks, known merchants only.", { summary: "t", currency: "USD", totalLimitCents: 20000, allowedCategories: ["running shoes", "running socks"], merchantPolicy: "verified_only", expiresAt: new Date(Date.now() + 864e5).toISOString() });
  const { agent } = await createAgent(userId, "hold test");
  const buy = (sku: string, price: number) => requestPurchase(agent, { productUrl: `${BASE}/stores/stride/products/${sku}`, quantity: 1, expectedPriceCents: price, userRequest: "buy it", reason: null });
  const rec = async (id: string) => { const r = await reconcilePurchase(userId, id); return `${r.ok ? "all match" : "MISMATCH"} [${r.rows.filter((x) => !x.match).map((x) => `${x.what}: ${x.gateway} vs ${x.paypal}`).join("; ")}]`; };

  const p1 = await buy("STR-TEMPO3", 8900);
  console.log("1 purchase:", p1.status, "| auth id:", !!p1.paypalAuthorizationId, "| capture id:", p1.paypalCaptureId);
  console.log("1 reconcile while reserved:", await rec(p1.id));
  const [o1] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.gatewayPurchaseId, p1.id));
  console.log("1 store order:", o1?.status);
  const shipped = await shipOrder("stride", o1.id, o1.sku);
  const [after] = await db.select().from(schema.purchases).where(eq(schema.purchases.id, p1.id));
  console.log("1 after shipping: store", shipped?.status, "tracking", !!shipped?.tracking, "| purchase", after.status, "capture id:", !!after.paypalCaptureId);
  console.log("1 reconcile after charge:", await rec(p1.id));

  const p2 = await buy("STR-CLOUD", 7900);
  console.log("2 purchase:", p2.status, p2.status === "pending_approval" ? "(page flagged, as expected for this product)" : "");
  const p3 = await buy("STR-CARBON", 13500);
  console.log("3 purchase over remaining budget:", p3.status);
  const p4 = await buy("STR-SOCK3", 1800);
  console.log("4 purchase:", p4.status, p4.decision.reason.slice(0, 90));
  if (p4.status === "authorized") {
    const c = await cancelHold(userId, p4.id);
    const [o4] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.gatewayPurchaseId, p4.id));
    console.log("4 cancelled:", c.status, "| store order:", o4?.status);
    console.log("4 reconcile after cancel:", await rec(p4.id));
    try { await cancelHold(userId, p4.id); console.log("4 second cancel: allowed (wrong)"); } catch (e) { console.log("4 second cancel refused:", (e as Error).message.slice(0, 80)); }
  }
  console.log("ledger intact:", (await verifyChain()).ok);
  process.exit(0);
}
main().catch((e) => { console.error("ERROR", String(e?.message ?? e).slice(0, 500)); process.exit(1); });
