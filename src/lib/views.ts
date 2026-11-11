// Read models for the web app. Pages and client components take their data from here and nowhere else.
import { desc, eq } from "drizzle-orm";
import { assistantDailyLimit, assistantRemaining } from "./assistant";
import { DEMO_MANDATE_CAP_CENTS, demoWalletAvailable } from "./demo-wallet";
import { appUrl, llmConfigured, paypalSimulated } from "./config";
import { db, schema } from "./db";
import { committedSpend, ensureSeed, getUser } from "./gateway";
import { listMerchants } from "./merchants";
import { normalizeRules } from "./rules";

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export async function dashboardState(userId: string) {
  await ensureSeed();
  const [user, [link], mandateRows, agentRows, merchantRows, rows, caseRows, merchantList, assistantLeft, demoAvailable] = await Promise.all([
    getUser(userId),
    db.select().from(schema.paypalLinks).where(eq(schema.paypalLinks.userId, userId)),
    db.select().from(schema.mandates).where(eq(schema.mandates.userId, userId)).orderBy(desc(schema.mandates.confirmedAt)),
    db.select().from(schema.agents).where(eq(schema.agents.userId, userId)).orderBy(desc(schema.agents.createdAt)),
    db.select().from(schema.merchants),
    db.select().from(schema.purchases).where(eq(schema.purchases.userId, userId)).orderBy(desc(schema.purchases.createdAt)).limit(200),
    db.select().from(schema.cases).where(eq(schema.cases.userId, userId)).orderBy(desc(schema.cases.createdAt)),
    listMerchants(userId),
    assistantRemaining(userId),
    demoWalletAvailable(),
  ]);
  const agentName = (id: string | null) => agentRows.find((a) => a.id === id)?.name ?? null;
  const merchantName = (id: string | null) => merchantRows.find((m) => m.id === id)?.name ?? null;
  const now = Date.now();

  const active = mandateRows.filter((m) => m.status === "active");
  const mandates = await Promise.all(active.map(async (m) => {
    const rules = normalizeRules(m.rules), spend = await committedSpend(db, m.id);
    return {
      id: m.id, name: m.name, sourceText: m.sourceText, rules, agentIds: m.agentIds, agentNames: m.agentIds ? m.agentIds.map(agentName).filter((x): x is string => !!x) : null,
      spentCents: spend.committedCents, todayCents: spend.todayCents, purchaseCount: spend.purchaseCount,
      confirmedAt: iso(m.confirmedAt), expired: new Date(rules.expiresAt).getTime() <= now,
    };
  }));

  const agents = agentRows.map((a) => {
    const mine = rows.filter((p) => p.agentId === a.id);
    return {
      id: a.id, name: a.name, keyPrefix: a.keyPrefix, builtIn: a.kind === "assistant", createdAt: a.createdAt.toISOString(), lastSeenAt: iso(a.lastSeenAt),
      status: a.revokedAt ? ("revoked" as const) : a.pausedAt ? ("paused" as const) : ("active" as const), pauseReason: a.pauseReason,
      stats: { requests: mine.length, paid: mine.filter((p) => ["captured", "authorized", "refunded", "partially_refunded", "refund_requested", "disputed"].includes(p.status)).length,
        blocked: mine.filter((p) => p.status === "blocked").length, spentCents: mine.filter((p) => ["captured", "authorized", "partially_refunded", "disputed", "refund_requested"].includes(p.status)).reduce((s, p) => s + p.amountCents - p.refundedCents, 0) },
    };
  });

  const purchases = rows.map((p) => {
    const c = caseRows.find((x) => x.purchaseId === p.id);
    const signals = p.product?.signals ?? [];
    return {
      id: p.id, status: p.status, createdAt: p.createdAt.toISOString(), productName: p.product?.name ?? null, productUrl: p.productUrl, sku: p.product?.sku ?? null,
      amountCents: p.amountCents, refundedCents: p.refundedCents, currency: p.currency, quantity: p.quantity,
      merchant: merchantName(p.merchantId), agent: agentName(p.agentId), agentId: p.agentId,
      mandateId: p.mandateId, mandateName: mandateRows.find((m) => m.id === p.mandateId)?.name ?? null,
      userRequest: p.userRequest, agentReason: p.agentReason, reason: p.decision.reason, outcome: p.decision.outcome, checks: p.decision.checks,
      paypalOrderId: p.paypalOrderId, paypalCaptureId: p.paypalCaptureId,
      /** True when the gateway found text aimed at AI agents on the merchant's page. */
      injectionFlag: signals.some((s) => s.kind === "agent_directed_text"), signals,
      approvalUrl: p.status === "pending_approval" && p.approvalToken ? `${appUrl()}/approve/${p.approvalToken}` : null,
      case: c ? { id: c.id, status: c.status, report: c.report, pendingOffer: c.pendingOffer ?? null, transcript: c.transcript ?? [],
        merchantReason: (c.merchantResponse as { reason?: string } | null)?.reason ?? null } : null,
      /** Kept for older components. */
      caseMessage: c ? { status: c.status, reason: (c.merchantResponse as { reason?: string } | null)?.reason ?? null } : null,
    };
  });

  // Fourteen days of activity, oldest first.
  const days = Array.from({ length: 14 }, (_, i) => new Date(now - (13 - i) * 864e5).toISOString().slice(0, 10));
  const paid = (p: (typeof rows)[number]) => ["captured", "authorized", "partially_refunded", "refund_requested", "disputed", "refunded"].includes(p.status);
  const byDay = days.map((day) => {
    const on = rows.filter((p) => p.createdAt.toISOString().slice(0, 10) === day);
    return { day, paidCents: on.filter(paid).reduce((s, p) => s + p.amountCents - p.refundedCents, 0), paidCount: on.filter(paid).length, blockedCount: on.filter((p) => p.status === "blocked").length };
  });
  const reasons = new Map<string, number>();
  for (const p of rows.filter((x) => x.status === "blocked")) {
    const rule = p.decision.checks.find((c) => !c.passed)?.rule ?? "other";
    reasons.set(rule, (reasons.get(rule) ?? 0) + 1);
  }

  return {
    appUrl: appUrl(), simulated: paypalSimulated(), llm: llmConfigured(),
    assistant: { remaining: assistantLeft, dailyLimit: assistantDailyLimit() },
    account: { frozen: !!user?.frozenAt, frozenAt: iso(user?.frozenAt), settings: { autoAcceptRefundPercent: user?.settings?.autoAcceptRefundPercent ?? 100, autoAcceptReplacement: !!user?.settings?.autoAcceptReplacement, notifyUrl: user?.settings?.notifyUrl ?? null, chargeOnShipment: !!user?.settings?.chargeOnShipment } },
    paypal: link?.status === "active" ? { email: link.isDemo ? "Demo wallet" : link.payerEmail, demo: link.isDemo } : null,
    demoWallet: { available: demoAvailable, mandateCapCents: DEMO_MANDATE_CAP_CENTS },
    mandates,
    /** The newest active mandate, for components that show one. */
    mandate: mandates[0] ?? null,
    pastMandates: mandateRows.filter((m) => m.status !== "active").map((m) => ({ id: m.id, name: m.name, sourceText: m.sourceText, status: m.status, confirmedAt: iso(m.confirmedAt) })),
    agents, purchases, merchants: merchantList,
    stats: {
      spentCents: rows.filter(paid).reduce((s, p) => s + p.amountCents - p.refundedCents, 0), refundedCents: rows.reduce((s, p) => s + p.refundedCents, 0),
      paidCount: rows.filter(paid).length, blockedCount: rows.filter((p) => p.status === "blocked").length, blockedCents: rows.filter((p) => p.status === "blocked").reduce((s, p) => s + p.amountCents, 0),
      pendingCount: rows.filter((p) => p.status === "pending_approval").length, offersWaiting: caseRows.filter((c) => c.status === "offer_pending").length,
      injectionFlags: purchases.filter((p) => p.injectionFlag).length,
      byDay, blockReasons: [...reasons.entries()].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count),
    },
  };
}
export type DashboardState = Awaited<ReturnType<typeof dashboardState>>;
export type PurchaseView = DashboardState["purchases"][number];
export type MandateView = DashboardState["mandates"][number];
export type AgentView = DashboardState["agents"][number];
export type MerchantView = DashboardState["merchants"][number];
