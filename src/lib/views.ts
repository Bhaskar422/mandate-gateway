import { desc, eq } from "drizzle-orm";
import { appUrl, llmConfigured, paypalSimulated } from "./config";
import { db, schema } from "./db";
import { activeMandate, committedSpend, ensureSeed } from "./gateway";

export async function dashboardState(userId: string) {
  await ensureSeed();
  const [link] = await db.select().from(schema.paypalLinks).where(eq(schema.paypalLinks.userId, userId));
  const mandate = await activeMandate(userId);
  const spend = mandate ? await committedSpend(db, mandate.id) : null;
  const agents = await db.select({ id: schema.agents.id, name: schema.agents.name, keyPrefix: schema.agents.keyPrefix, createdAt: schema.agents.createdAt })
    .from(schema.agents).where(eq(schema.agents.userId, userId)).orderBy(desc(schema.agents.createdAt));
  const merchants = await db.select().from(schema.merchants);
  const rows = await db.select().from(schema.purchases).where(eq(schema.purchases.userId, userId)).orderBy(desc(schema.purchases.createdAt)).limit(50);
  const cases = await db.select().from(schema.cases).where(eq(schema.cases.userId, userId)).orderBy(desc(schema.cases.createdAt));
  const name = (id: string | null, list: { id: string; name: string }[]) => list.find((x) => x.id === id)?.name ?? null;
  return {
    appUrl: appUrl(), simulated: paypalSimulated(), llm: llmConfigured(),
    paypal: link?.status === "active" ? { email: link.payerEmail } : null,
    mandate: mandate ? { id: mandate.id, sourceText: mandate.sourceText, rules: mandate.rules, spentCents: spend!.committedCents, purchaseCount: spend!.purchaseCount } : null,
    agents: agents.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    purchases: rows.map((p) => ({
      id: p.id, status: p.status, createdAt: p.createdAt.toISOString(), productName: p.product?.name ?? null, productUrl: p.productUrl,
      amountCents: p.amountCents, currency: p.currency, quantity: p.quantity, merchant: name(p.merchantId, merchants), agent: name(p.agentId, agents),
      userRequest: p.userRequest, reason: p.decision.reason, checks: p.decision.checks, paypalOrderId: p.paypalOrderId,
      caseMessage: (() => { const c = cases.find((x) => x.purchaseId === p.id); return c ? { status: c.status, reason: (c.merchantResponse as { reason?: string } | null)?.reason ?? null } : null; })(),
    })),
  };
}
export type DashboardState = Awaited<ReturnType<typeof dashboardState>>;
