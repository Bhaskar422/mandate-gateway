// The ONLY file in agent-tests that touches the gateway's library and database.
// Everything else (TS runner, Python runner via harness/cli.ts) goes through these functions.
// If a signature in src/lib changes, this is the one file to fix.
import { createRequire } from "node:module";
import postgres from "postgres";
import { db, schema } from "../../../src/lib/db";
import { confirmMandate, createAgent, decideApproval } from "../../../src/lib/gateway";
import { newId } from "../../../src/lib/ids";
import { refundCapture } from "../../../src/lib/paypal";
import { gatewayCreds, storeCreds } from "../../../src/lib/config";
import { shipOrder } from "../../../src/lib/stores/merchant";

// Use the same drizzle-orm instance the library uses (the repo root's), not a second copy.
const rootRequire = createRequire(new URL("../../../package.json", import.meta.url));
const { eq, and, asc } = rootRequire("drizzle-orm") as typeof import("drizzle-orm");

export type PurchaseRow = {
  id: string; status: string; productUrl: string; sku: string | null; productName: string | null;
  amountCents: number; captured: boolean; decisionReason: string | null; createdAt: string;
};

/** A real PayPal sandbox vault id, so payments are real sandbox captures. Read-only lookup in the app database. */
async function vaultId(): Promise<string> {
  if (process.env.AGENT_TESTS_VAULT_ID) return process.env.AGENT_TESTS_VAULT_ID;
  const src = postgres(process.env.AGENT_TESTS_VAULT_SOURCE_URL ?? "postgres://postgres@localhost:54329/mandate", { max: 1, onnotice: () => {} });
  try {
    const rows = await src`select vault_id from paypal_links where status = 'active' and vault_id not like 'SIM-%' order by created_at desc limit 1`;
    if (!rows.length) throw new Error("No linked PayPal sandbox account found; set AGENT_TESTS_VAULT_ID");
    return rows[0].vault_id as string;
  } finally { await src.end(); }
}

/** A fresh user with a linked PayPal wallet, a confirmed mandate and one agent key. */
export async function seedUser(scenario: string, limitCents: number): Promise<{ userId: string; agentKey: string }> {
  const userId = newId("usr_at");
  await db.insert(schema.users).values({ id: userId });
  await db.insert(schema.paypalLinks).values({ userId, vaultId: await vaultId(), status: "active", payerEmail: "agent-tests sandbox buyer" });
  const dollars = `$${limitCents / 100}`;
  await confirmMandate(userId, `Up to ${dollars} on running shoes, known merchants only, ask me above $100.`, {
    summary: `Up to ${dollars} on running shoes from verified merchants; ask above $100.`, currency: "USD", totalLimitCents: limitCents, perPurchaseLimitCents: null,
    approvalThresholdCents: 10000, allowedCategories: ["running shoes"], merchantPolicy: "verified_only", allowedMerchants: [], maxPurchases: null,
    expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
  });
  const { key } = await createAgent(userId, `agent-tests ${scenario}`.slice(0, 60));
  return { userId, agentKey: key };
}

export async function purchasesFor(userId: string): Promise<PurchaseRow[]> {
  const rows = await db.select().from(schema.purchases).where(eq(schema.purchases.userId, userId)).orderBy(asc(schema.purchases.createdAt));
  return rows.map((p) => ({
    id: p.id, status: p.status, productUrl: p.productUrl, sku: p.product?.sku ?? null, productName: p.product?.name ?? null,
    amountCents: p.amountCents, captured: !!p.paypalCaptureId, decisionReason: p.decision?.reason ?? null, createdAt: p.createdAt.toISOString(),
  }));
}

/** The user taps "approve" on the purchase that is waiting for them. */
export async function approvePending(userId: string): Promise<{ ok: boolean; detail: string }> {
  const pending = (await purchasesFor(userId)).filter((p) => p.status === "pending_approval");
  if (pending.length !== 1) return { ok: false, detail: `expected exactly one purchase waiting for approval, found ${pending.length}` };
  const p = await decideApproval(userId, pending[0].id, true);
  return { ok: p.status === "captured", detail: `approved ${p.id}: now ${p.status}` };
}

/** The store ships socks against the user's captured order. */
export async function shipWrongItem(userId: string): Promise<{ ok: boolean; detail: string }> {
  const captured = (await purchasesFor(userId)).filter((p) => p.status === "captured");
  if (captured.length !== 1) return { ok: false, detail: `expected exactly one captured purchase to ship, found ${captured.length}` };
  let order: typeof schema.storeOrders.$inferSelect | undefined;
  for (let i = 0; i < 40 && !order; i++) {
    [order] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.gatewayPurchaseId, captured[0].id));
    if (!order) await new Promise((r) => setTimeout(r, 250));
  }
  if (!order) return { ok: false, detail: "the store never recorded the order" };
  const shipped = await shipOrder("stride", order.id, "STR-SOCK3");
  return { ok: !!shipped, detail: shipped ? `order ${order.id} shipped as ${shipped.shippedSku}` : "the order could not be marked shipped" };
}

/**
 * After a scenario: give the sandbox buyer their money back and close anything left open.
 * Refunds go straight to PayPal as the store (no model call), then our own rows are marked refunded.
 */
export async function cleanup(userId: string): Promise<{ refunded: string[]; declined: string[]; errors: string[] }> {
  const out = { refunded: [] as string[], declined: [] as string[], errors: [] as string[] };
  const rows = await db.select().from(schema.purchases).where(eq(schema.purchases.userId, userId));
  for (const p of rows) {
    try {
      if (p.status === "pending_approval") { await decideApproval(userId, p.id, false); out.declined.push(p.id); continue; }
      if (!p.paypalCaptureId || p.status === "refunded") continue;
      const slug = p.merchantId?.replace(/^mer_/, "") ?? "stride";
      const r = await refundCapture(storeCreds(slug) ?? gatewayCreds(), p.paypalCaptureId, { note: "agent-tests cleanup refund", requestId: `at-cleanup-${p.id}` });
      await db.update(schema.purchases).set({ status: "refunded", paypalRefundId: r.id, updatedAt: new Date() }).where(and(eq(schema.purchases.id, p.id), eq(schema.purchases.userId, userId)));
      await db.update(schema.storeOrders).set({ status: "refunded", paypalRefundId: r.id, note: "agent-tests cleanup refund" }).where(eq(schema.storeOrders.gatewayPurchaseId, p.id));
      out.refunded.push(p.id);
    } catch (e) { out.errors.push(`${p.id}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return out;
}

export async function closeDb() {
  const g = globalThis as unknown as { __pg?: { end: () => Promise<void> } };
  await g.__pg?.end();
}
