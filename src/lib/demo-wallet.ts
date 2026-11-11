// The demo wallet: one PayPal sandbox buyer the operator lends to visitors, so someone without a sandbox account
// can still make a real sandbox purchase. Everyone who uses it spends from the same sandbox balance, so it is
// capped per mandate and per day, and it is never used to sign anyone in.
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { append } from "./ledger";

const KEY = "demo_wallet";
/** The most a single mandate may authorise when it spends from the demo wallet. */
export const DEMO_MANDATE_CAP_CENTS = Number(process.env.DEMO_MANDATE_CAP_CENTS ?? 20_000);
/** The most all demo-wallet users together may spend in one UTC day. */
export const DEMO_DAILY_CAP_CENTS = Number(process.env.DEMO_DAILY_CAP_CENTS ?? 100_000);

type DemoWallet = { vaultId: string; setAt: string };
export async function demoWallet(): Promise<DemoWallet | null> {
  const [r] = await db.select().from(schema.gatewaySettings).where(eq(schema.gatewaySettings.key, KEY));
  const v = r?.value as Partial<DemoWallet> | undefined;
  return v?.vaultId ? { vaultId: v.vaultId, setAt: v.setAt ?? r.updatedAt.toISOString() } : null;
}
/** Never throws: a dashboard must still load if the settings table is unreachable. */
export const demoWalletAvailable = async () => { try { return !!(await demoWallet()); } catch (e) { console.error("demo wallet lookup failed:", e); return false; } };

/** Operator: lend out the wallet that is linked in the operator's own browser session. */
export async function setDemoWalletFromUser(userId: string) {
  const [link] = await db.select().from(schema.paypalLinks).where(eq(schema.paypalLinks.userId, userId));
  if (!link || link.status !== "active" || !link.vaultId) throw new Error("No PayPal wallet is linked in this browser. Link a sandbox buyer on the dashboard first, then come back.");
  if (link.isDemo) throw new Error("This browser is itself using the demo wallet. Link a real sandbox buyer first.");
  const value = { vaultId: link.vaultId, setAt: new Date().toISOString() };
  await db.insert(schema.gatewaySettings).values({ key: KEY, value }).onConflictDoUpdate({ target: schema.gatewaySettings.key, set: { value, updatedAt: new Date() } });
}
export async function clearDemoWallet() { await db.delete(schema.gatewaySettings).where(eq(schema.gatewaySettings.key, KEY)); }

/** A visitor with no wallet takes the demo wallet. */
export async function useDemoWallet(userId: string) {
  const w = await demoWallet();
  if (!w) throw new Error("This gateway has no demo wallet set up. Link your own PayPal sandbox account instead.");
  const [link] = await db.select().from(schema.paypalLinks).where(eq(schema.paypalLinks.userId, userId));
  if (link?.status === "active" && link.vaultId) throw new Error("A PayPal wallet is already linked to this account.");
  const row = { vaultId: w.vaultId, status: "active" as const, isDemo: true, payerEmail: null, payerId: null, customerId: null, setupTokenId: null };
  await db.insert(schema.paypalLinks).values({ userId, ...row }).onConflictDoUpdate({ target: schema.paypalLinks.userId, set: row });
  await append({ userId, type: "paypal.linked", payload: { demoWallet: true } });
}

export async function isDemoUser(userId: string) {
  const [link] = await db.select({ isDemo: schema.paypalLinks.isDemo }).from(schema.paypalLinks).where(eq(schema.paypalLinks.userId, userId));
  return !!link?.isDemo;
}

/** What all demo-wallet users have committed today (UTC), net of refunds. */
export async function demoSpentToday() {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const [r] = await db.select({ cents: sql<number>`coalesce(sum(${schema.purchases.amountCents} - ${schema.purchases.refundedCents}), 0)::int` }).from(schema.purchases)
    .innerJoin(schema.paypalLinks, eq(schema.paypalLinks.userId, schema.purchases.userId))
    .where(and(eq(schema.paypalLinks.isDemo, true), gte(schema.purchases.createdAt, start), inArray(schema.purchases.status, ["captured", "authorized", "partially_refunded", "refund_requested", "disputed"])));
  return r?.cents ?? 0;
}
