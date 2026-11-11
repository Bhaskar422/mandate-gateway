import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { appUrl, paypalSimulated, storePayee } from "./config";
import { db, schema, type Tx } from "./db";
import type { SettlementOffer, SettlementTurn, UserSettings } from "./db/schema";
import { canonical, money, newId, sha256 } from "./ids";
import { append, evidenceBundle } from "./ledger";
import { analyseProblem, classifyProduct } from "./llm";
import { getUser } from "./gateway-user";
import { DEMO_DAILY_CAP_CENTS, demoSpentToday } from "./demo-wallet";
import { notify, validNotifyUrl } from "./notify";
import { PayPalError, payWithVault, holdWithVault, captureHold } from "./paypal";
import { best, evaluate, type Classification, type Decision } from "./policy";
import { fetchProduct, type ProductSnapshot } from "./product";
import { normalizeRules, type MandateRules, type MandateRulesInput } from "./rules";
import { STORES } from "./stores/catalog";

const { purchases, mandates, merchants, paypalLinks, agents, cases, users } = schema;
/** Purchases that count against a mandate's budget. Refunded money goes back to the budget. */
const COMMITTED = ["pending_approval", "paying", "captured", "authorized", "refund_requested", "partially_refunded", "disputed"] as const;
export const RATE_LIMIT_PER_MINUTE = 12;
/** An agent is paused after this many blocked attempts inside the window. */
export const AUTO_PAUSE = { blocked: 5, windowMinutes: 10 };

type Purchase = typeof purchases.$inferSelect;
type Agent = typeof agents.$inferSelect;
export type AgentRef = Pick<Agent, "id" | "userId" | "name"> & Partial<Pick<Agent, "pausedAt" | "pauseReason">>;

// ---- Merchant registry ----------------------------------------------------------------------

let seeded: Promise<void> | null = null;
/** Register the built-in demo stores. Stores marked `builtin: false` have to onboard themselves. */
export const ensureSeed = () => (seeded ??= (async () => {
  for (const s of STORES.filter((x) => x.builtin !== false)) {
    const payee = storePayee(s.slug);
    const base = `${appUrl()}/stores/${s.slug}`;
    const row = { name: s.name, baseUrl: base, verified: s.verified, paypalMerchantId: payee.merchantId, paypalEmail: payee.email, source: "builtin" as const, ordersUrl: `${base}/api/orders`, returnsUrl: `${base}/api/returns`, supportsHold: true };
    await db.insert(merchants).values({ id: `mer_${s.slug}`, ...row }).onConflictDoUpdate({ target: merchants.id, set: row });
  }
})().catch((e) => { seeded = null; throw e; }));

const payable = (m: typeof merchants.$inferSelect) =>
  (m.source === "builtin" || !!m.domainVerifiedAt) && (paypalSimulated() || !!m.paypalMerchantId || !!m.paypalEmail);

export async function resolveMerchant(productUrl: string) {
  await ensureSeed();
  let u: URL;
  try { u = new URL(productUrl); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const norm = u.toString();
  const all = await db.select().from(merchants);
  // Longest base URL wins, so a store under a path is not shadowed by its host.
  return all.filter((m) => norm === m.baseUrl || norm.startsWith(`${m.baseUrl}/`)).sort((a, b) => b.baseUrl.length - a.baseUrl.length)[0] ?? null;
}

/**
 * Turn the merchant names a person wrote ("Stride") into the registry's exact names ("Stride Running Co.").
 * This runs before the user confirms, so they approve the resolved name. The policy engine then matches exactly.
 */
export async function resolveMerchantNames(names: string[]) {
  await ensureSeed();
  const all = await db.select().from(merchants);
  const words = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const resolved: string[] = [], unknown: string[] = [];
  for (const raw of names) {
    const w = words(raw), host = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const hits = all.filter((m) => {
      const mw = words(m.name);
      const mHost = (() => { try { return new URL(m.baseUrl).hostname; } catch { return ""; } })();
      return (w.length > 0 && w.every((t, i) => mw[i] === t)) || (host.includes(".") && mHost === host);
    });
    if (hits.length === 1) { if (!resolved.includes(hits[0].name)) resolved.push(hits[0].name); }
    else { unknown.push(raw); resolved.push(raw); }
  }
  return { resolved, unknown };
}

// ---- Account ----------------------------------------------------------------------------------

export { getUser };
/** The kill switch. While frozen, every agent purchase is blocked, including approvals already waiting. */
export async function setFrozen(userId: string, frozen: boolean) {
  await db.update(users).set({ frozenAt: frozen ? new Date() : null }).where(eq(users.id, userId));
  await append({ userId, type: frozen ? "account.frozen" : "account.unfrozen", payload: {} });
}
export async function updateSettings(userId: string, patch: UserSettings) {
  const u = await getUser(userId);
  const pct = patch.autoAcceptRefundPercent;
  const settings: UserSettings = { ...(u?.settings ?? {}), ...patch, ...(pct === undefined ? {} : { autoAcceptRefundPercent: Math.min(100, Math.max(1, Math.round(pct))) }),
    ...(patch.notifyUrl === undefined ? {} : { notifyUrl: patch.notifyUrl ? validNotifyUrl(patch.notifyUrl) : null }) };
  await db.update(users).set({ settings }).where(eq(users.id, userId));
  return settings;
}

// ---- Mandates ---------------------------------------------------------------------------------

export const rulesHash = (r: MandateRules) => sha256(canonical(r));
const withRules = <T extends { rules: MandateRules }>(m: T): T => ({ ...m, rules: normalizeRules(m.rules) });

/** Active mandates, newest first. With an agent id, only the mandates that apply to that agent. */
export async function activeMandates(userId: string, agentId?: string) {
  const rows = await db.select().from(mandates).where(and(eq(mandates.userId, userId), eq(mandates.status, "active"))).orderBy(desc(mandates.confirmedAt));
  return rows.map(withRules).filter((m) => !agentId || !m.agentIds || m.agentIds.includes(agentId));
}
export const activeMandate = async (userId: string, agentId?: string) => (await activeMandates(userId, agentId))[0] ?? null;

export async function committedSpend(t: Tx | typeof db, mandateId: string, opts: { excludePurchaseId?: string; merchantId?: string | null } | string = {}) {
  const o = typeof opts === "string" ? { excludePurchaseId: opts } : opts;
  const net = sql`(${purchases.amountCents} - ${purchases.refundedCents})`;
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const [r] = await t.select({
    cents: sql<number>`coalesce(sum(${net}), 0)::int`, n: sql<number>`count(*)::int`,
    today: sql<number>`coalesce(sum(${net}) filter (where ${purchases.createdAt} >= ${startOfDay.toISOString()}::timestamptz), 0)::int`,
    merchant: o.merchantId ? sql<number>`coalesce(sum(${net}) filter (where ${purchases.merchantId} = ${o.merchantId}), 0)::int` : sql<number>`0`,
  }).from(purchases).where(and(eq(purchases.mandateId, mandateId), inArray(purchases.status, [...COMMITTED]), o.excludePurchaseId ? ne(purchases.id, o.excludePurchaseId) : undefined));
  return { committedCents: r.cents, purchaseCount: r.n, todayCents: r.today, merchantCents: r.merchant };
}

/**
 * Confirm a mandate. Several can be active at once. Pass `replaceId` to swap one out, or `replaceAll`
 * to make this the only one.
 */
export async function confirmMandate(userId: string, sourceText: string, rules: MandateRulesInput, opts: { name?: string | null; agentIds?: string[] | null; replaceId?: string; replaceAll?: boolean } = {}) {
  const clean = normalizeRules(rules);
  return db.transaction(async (t) => {
    const cond = opts.replaceAll ? undefined : opts.replaceId ? eq(mandates.id, opts.replaceId) : sql`false`;
    const old = await t.update(mandates).set({ status: "revoked" }).where(and(eq(mandates.userId, userId), eq(mandates.status, "active"), cond)).returning({ id: mandates.id });
    for (const o of old) await append({ userId, type: "mandate.revoked", payload: { mandateId: o.id, reason: "replaced" } }, t);
    const [m] = await t.insert(mandates).values({ id: newId("man"), userId, name: opts.name?.slice(0, 60) || null, agentIds: opts.agentIds?.length ? opts.agentIds : null,
      sourceText, rules: clean, rulesHash: rulesHash(clean), status: "active", confirmedAt: new Date() }).returning();
    await append({ userId, type: "mandate.confirmed", payload: { mandateId: m.id, name: m.name, agentIds: m.agentIds, sourceText, rules: clean, rulesHash: m.rulesHash } }, t);
    return m;
  });
}
/** Revoke one mandate, or every active one when no id is given. */
export async function revokeMandate(userId: string, mandateId?: string) {
  const old = await db.update(mandates).set({ status: "revoked" }).where(and(eq(mandates.userId, userId), eq(mandates.status, "active"), mandateId ? eq(mandates.id, mandateId) : undefined)).returning({ id: mandates.id });
  for (const o of old) await append({ userId, type: "mandate.revoked", payload: { mandateId: o.id, reason: "revoked by user" } });
  return old.length;
}

// ---- Agents -----------------------------------------------------------------------------------

export async function createAgent(userId: string, name: string) {
  const key = `mk_${newId("live").slice(5)}${newId("x").slice(2)}`;
  const [a] = await db.insert(agents).values({ id: newId("agt"), userId, name: name.slice(0, 60) || "Agent", keyHash: sha256(key), keyPrefix: key.slice(0, 9) }).returning();
  return { agent: a, key };
}
export async function agentFromKey(key: string | null | undefined) {
  if (!key) return null;
  const [a] = await db.select().from(agents).where(eq(agents.keyHash, sha256(key))).limit(1);
  if (!a || a.revokedAt) return null;
  db.update(agents).set({ lastSeenAt: new Date() }).where(eq(agents.id, a.id)).catch(() => {});
  return a;
}
async function ownAgent(userId: string, agentId: string) {
  const [a] = await db.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.userId, userId)));
  if (!a) throw new Error("Agent not found");
  return a;
}
export async function pauseAgent(userId: string, agentId: string, reason = "paused by the user") {
  const a = await ownAgent(userId, agentId);
  await db.update(agents).set({ pausedAt: new Date(), pauseReason: reason }).where(eq(agents.id, a.id));
  await append({ userId, type: "agent.paused", payload: { agentId, name: a.name, reason } });
}
export async function resumeAgent(userId: string, agentId: string) {
  const a = await ownAgent(userId, agentId);
  await db.update(agents).set({ pausedAt: null, pauseReason: null }).where(eq(agents.id, a.id));
  await append({ userId, type: "agent.resumed", payload: { agentId, name: a.name } });
}
/** Issue a new key for an agent and invalidate the old one, without losing its history or mandate scoping. */
export async function rotateAgentKey(userId: string, agentId: string) {
  const a = await ownAgent(userId, agentId);
  if (a.revokedAt) throw new Error("This agent's key was revoked");
  const key = `mk_${newId("live").slice(5)}${newId("x").slice(2)}`;
  await db.update(agents).set({ keyHash: sha256(key), keyPrefix: key.slice(0, 9) }).where(eq(agents.id, a.id));
  await append({ userId, type: "agent.key_rotated", payload: { agentId, name: a.name } });
  return key;
}
/** Permanently disable an agent's key. */
export async function revokeAgent(userId: string, agentId: string) {
  const a = await ownAgent(userId, agentId);
  await db.update(agents).set({ revokedAt: new Date() }).where(eq(agents.id, a.id));
  await append({ userId, type: "agent.revoked", payload: { agentId, name: a.name } });
}

// ---- Purchases --------------------------------------------------------------------------------

export type PurchaseInput = { productUrl: string; quantity: number; expectedPriceCents: number | null; userRequest: string; reason: string | null; idempotencyKey?: string | null };
const lockUser = (t: Tx, userId: string) => t.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

/** Everything the policy needs that does not depend on a database lock. The gateway establishes all of it itself. */
async function gather(agent: AgentRef, input: PurchaseInput) {
  const merchant = await resolveMerchant(input.productUrl);
  // The gateway only ever fetches pages under a registered merchant's base URL.
  const product = merchant ? await fetchProduct(input.productUrl) : null;
  const everyMandate = await activeMandates(agent.userId);
  const candidates = everyMandate.filter((m) => !m.agentIds || m.agentIds.includes(agent.id));
  // "Never buy from X" is a prohibition, not a permission, so it applies whichever mandate a purchase would use.
  const neverBuy = [...new Set(everyMandate.flatMap((m) => m.rules.blockedMerchants ?? []))];
  const classify = new Map<string, Classification | null>();
  if (product) for (const m of candidates) {
    const k = JSON.stringify(m.rules.allowedCategories);
    if (!classify.has(k)) classify.set(k, await classifyProduct(product, m.rules.allowedCategories));
  }
  const [link] = await db.select().from(paypalLinks).where(eq(paypalLinks.userId, agent.userId));
  return { merchant, product, candidates, classify, link, neverBuy };
}

async function decide(t: Tx | typeof db, agent: AgentRef, input: PurchaseInput, g: Awaited<ReturnType<typeof gather>>, excludePurchaseId?: string) {
  const user = (await t.select().from(users).where(eq(users.id, agent.userId)))[0];
  const [fresh] = await t.select().from(agents).where(eq(agents.id, agent.id));
  const [{ n: recent }] = await t.select({ n: sql<number>`count(*)::int` }).from(purchases)
    .where(and(eq(purchases.agentId, agent.id), gte(purchases.createdAt, new Date(Date.now() - 60_000))));
  const common = {
    now: new Date(), accountFrozen: !!user?.frozenAt,
    agent: { paused: !!fresh?.pausedAt, pauseReason: fresh?.pauseReason ?? null },
    rate: { recentRequests: recent, limit: RATE_LIMIT_PER_MINUTE },
    merchant: g.merchant ? { name: g.merchant.name, baseUrl: g.merchant.baseUrl, verified: g.merchant.verified, payable: payable(g.merchant), domainVerified: !!g.merchant.domainVerifiedAt } : null,
    product: g.product ? { name: g.product.name, priceCents: g.product.priceCents, currency: g.product.currency } : null,
    quantity: input.quantity, agentExpectedPriceCents: input.expectedPriceCents,
    paymentMethodLinked: g.link?.status === "active" && !!g.link.vaultId,
    pageSignals: g.product?.signals, neverBuy: g.neverBuy,
  };
  if (!g.candidates.length) return { decision: { ...evaluate({ ...common, mandate: null, spend: { committedCents: 0, purchaseCount: 0 }, classification: null }), mandateId: null }, mandate: null, classification: null as Classification | null, spend: null };
  const all = [];
  for (const m of g.candidates) {
    const spend = await committedSpend(t, m.id, { merchantId: g.merchant?.id, excludePurchaseId });
    const classification = g.classify.get(JSON.stringify(m.rules.allowedCategories)) ?? null;
    all.push({ mandate: m, spend, classification, decision: { ...evaluate({ ...common, mandate: { status: m.status, rules: m.rules }, spend, classification }), mandateId: m.id } });
  }
  const chosen = best(all.map((x) => x.decision));
  return all.find((x) => x.decision === chosen)!;
}

/** A dry run: what would happen if the agent requested this purchase now. Nothing is recorded or paid. */
export async function checkPurchase(agent: AgentRef, input: PurchaseInput) {
  const g = await gather(agent, input);
  const r = await decide(db, agent, input, g);
  return { decision: r.decision, product: g.product, merchant: g.merchant, amountCents: (g.product?.priceCents ?? 0) * Math.max(input.quantity, 0) };
}

export async function requestPurchase(agent: AgentRef, input: PurchaseInput) {
  const userId = agent.userId;
  // Retrying is safe: the same key, or the same product still in flight, returns the purchase already made.
  const dupe = async (t: Tx | typeof db) => {
    if (input.idempotencyKey) {
      const [p] = await t.select().from(purchases).where(and(eq(purchases.agentId, agent.id), eq(purchases.idempotencyKey, input.idempotencyKey)));
      if (p) return p;
    }
    // Without a key, only an identical request (same product, quantity and price seen) counts as a retry.
    if (input.expectedPriceCents === null) return null;
    const [p] = await t.select().from(purchases).where(and(eq(purchases.agentId, agent.id), eq(purchases.productUrl, input.productUrl), eq(purchases.quantity, input.quantity),
      eq(purchases.expectedPriceCents, input.expectedPriceCents), inArray(purchases.status, ["paying", "pending_approval", "captured", "authorized"]), gte(purchases.createdAt, new Date(Date.now() - 120_000)))).orderBy(desc(purchases.createdAt)).limit(1);
    return p ?? null;
  };
  const existing = await dupe(db);
  if (existing) return existing;

  const g = await gather(agent, input);
  const purchase = await db.transaction(async (t) => {
    await lockUser(t, userId);
    const again = await dupe(t);
    if (again) return again;
    const { decision, mandate, classification, spend } = await decide(t, agent, input, g);
    const id = newId("pur");
    const status = decision.outcome === "approve" ? "paying" : decision.outcome === "needs_approval" ? "pending_approval" : "blocked";
    await append({ userId, purchaseId: id, type: "purchase.requested", payload: {
      agent: { id: agent.id, name: agent.name }, userRequest: input.userRequest, agentReason: input.reason,
      productUrl: input.productUrl, quantity: input.quantity, agentExpectedPriceCents: input.expectedPriceCents,
      merchant: g.merchant ? { id: g.merchant.id, name: g.merchant.name, baseUrl: g.merchant.baseUrl, verified: g.merchant.verified } : null,
      productSeenByGateway: g.product, mandate: mandate ? { id: mandate.id, name: mandate.name, rulesHash: mandate.rulesHash, sourceText: mandate.sourceText } : null,
    } }, t);
    await append({ userId, purchaseId: id, type: "purchase.decided", payload: { ...decision, classification, spendBefore: spend, mandatesConsidered: g.candidates.map((m) => m.id) } }, t);
    const [row] = await t.insert(purchases).values({
      id, userId, mandateId: mandate?.id ?? null, agentId: agent.id, merchantId: g.merchant?.id ?? null, status,
      productUrl: input.productUrl, product: g.product, quantity: input.quantity, amountCents: (g.product?.priceCents ?? 0) * Math.max(input.quantity, 0),
      currency: g.product?.currency ?? mandate?.rules.currency ?? "USD", userRequest: input.userRequest, agentReason: input.reason, decision,
      expectedPriceCents: input.expectedPriceCents, idempotencyKey: input.idempotencyKey ?? null, approvalToken: status === "pending_approval" ? newId("apr").slice(4) + newId("x").slice(2) : null,
    }).returning();
    return row;
  });
  const name = purchase.product?.name ?? purchase.productUrl, amount = purchase.product ? money(purchase.amountCents, purchase.currency) : "";
  const flagged = (purchase.product?.signals ?? []).some((s) => s.kind === "agent_directed_text");
  if (purchase.status === "blocked") { await autoPause(agent); await notify(userId, { kind: "blocked", title: `Blocked: ${name} ${amount}`.trim(), detail: `${agent.name}: ${purchase.decision.reason}`, url: `${appUrl()}/purchases/${purchase.id}` }); }
  if (purchase.status === "pending_approval") await notify(userId, { kind: flagged ? "injection_flagged" : "approval_needed", title: `Approval needed: ${name} ${amount}`.trim(),
    detail: `${agent.name} wants to buy this. ${purchase.decision.reason}`, url: `${appUrl()}/approve/${purchase.approvalToken}` });
  return purchase.status === "paying" && !purchase.paypalOrderId ? pay(purchase.id) : purchase;
}

/** Repeated blocked attempts are how a hijacked agent looks. Pause it and let the user decide. */
async function autoPause(agent: AgentRef) {
  const since = new Date(Date.now() - AUTO_PAUSE.windowMinutes * 60_000);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(purchases).where(and(eq(purchases.agentId, agent.id), eq(purchases.status, "blocked"), gte(purchases.createdAt, since)));
  const [a] = await db.select().from(agents).where(eq(agents.id, agent.id));
  if (n < AUTO_PAUSE.blocked || !a || a.pausedAt) return;
  const reason = `paused automatically after ${n} blocked attempts in ${AUTO_PAUSE.windowMinutes} minutes`;
  await db.update(agents).set({ pausedAt: new Date(), pauseReason: reason }).where(eq(agents.id, a.id));
  await append({ userId: a.userId, type: "agent.paused", payload: { agentId: a.id, name: a.name, reason, automatic: true } });
  await notify(a.userId, { kind: "agent_paused", title: `Agent paused: ${a.name}`, detail: `The gateway ${reason}. Resume it from the dashboard if this was expected.`, url: `${appUrl()}/agents` });
}

/** Charge the vaulted wallet. Only ever called after the policy engine (or the user) approved. */
export async function pay(purchaseId: string) {
  const [p] = await db.select().from(purchases).where(eq(purchases.id, purchaseId));
  if (!p || p.status !== "paying" || !p.product || !p.merchantId) throw new Error("Purchase is not payable");
  const [m] = await db.select().from(merchants).where(eq(merchants.id, p.merchantId));
  const [link] = await db.select().from(paypalLinks).where(eq(paypalLinks.userId, p.userId));
  const set = async (v: Partial<typeof purchases.$inferInsert>) => (await db.update(purchases).set({ ...v, updatedAt: new Date() }).where(eq(purchases.id, p.id)).returning())[0];
  try {
    // The demo wallet is one sandbox buyer shared by every visitor who uses it, so its spending is capped per day.
    if (link.isDemo && (await demoSpentToday()) + p.amountCents > DEMO_DAILY_CAP_CENTS) {
      await append({ userId: p.userId, purchaseId: p.id, type: "payment.failed", payload: { reason: "The shared demo wallet has reached its limit for today" } });
      return set({ status: "payment_failed" });
    }
    const payee = process.env.PAYPAL_PAYEE_MODE === "platform" ? null : { merchantId: m.paypalMerchantId, email: m.paypalEmail };
    const order = {
      vaultId: link.vaultId!, amountCents: p.amountCents, currency: p.currency, referenceId: p.id, payee,
      description: `${p.product.name} from ${m.name}`, itemName: p.product.name, sku: p.product.sku, quantity: p.quantity, unitCents: p.product.priceCents,
    };
    const notifyStore = async (entry: unknown) => {
      // Awaited, because a serverless host may stop the function as soon as the response is sent.
      if (m.ordersUrl) await fetch(m.ordersUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry }), signal: AbortSignal.timeout(15_000) })
        .catch((e) => console.error("merchant order notification failed:", e));
    };
    const about = { amountCents: p.amountCents, currency: p.currency, merchant: { id: m.id, name: m.name, baseUrl: m.baseUrl }, sku: p.product.sku, productName: p.product.name, quantity: p.quantity };

    // Charge on shipment: reserve the money now, take it only when the store says it has shipped.
    const buyer = await getUser(p.userId);
    if (buyer?.settings?.chargeOnShipment && m.supportsHold && m.ordersUrl) {
      const h = await holdWithVault(order);
      if (h.status !== "COMPLETED" || !h.authorizationId) {
        await append({ userId: p.userId, purchaseId: p.id, type: "payment.failed", payload: { orderId: h.orderId, status: h.status, authorizationStatus: h.authorizationStatus } });
        return set({ status: "payment_failed", paypalOrderId: h.orderId });
      }
      const entry = await append({ userId: p.userId, purchaseId: p.id, type: "payment.authorized", payload: { paypalOrderId: h.orderId, paypalAuthorizationId: h.authorizationId, expiresAt: h.expiresAt, ...about } });
      const row = await set({ status: "authorized", paypalOrderId: h.orderId, paypalAuthorizationId: h.authorizationId });
      await notifyStore(entry);
      return row;
    }

    const r = await payWithVault(order);
    if (r.status !== "COMPLETED" || !r.captureId) {
      await append({ userId: p.userId, purchaseId: p.id, type: "payment.failed", payload: { orderId: r.orderId, status: r.status, captureStatus: r.captureStatus } });
      return set({ status: "payment_failed", paypalOrderId: r.orderId });
    }
    const entry = await append({ userId: p.userId, purchaseId: p.id, type: "payment.captured", payload: { paypalOrderId: r.orderId, paypalCaptureId: r.captureId, ...about } });
    const row = await set({ status: "captured", paypalOrderId: r.orderId, paypalCaptureId: r.captureId });
    // Tell the merchant it has a paid order to fulfil, with the signed capture record as proof.
    await notifyStore(entry);
    return row;
  } catch (e) {
    const detail = e instanceof PayPalError ? { status: e.status, issue: e.issue, debugId: e.debugId, body: e.body } : { message: String(e) };
    console.error("payment failed:", e);
    await append({ userId: p.userId, purchaseId: p.id, type: "payment.failed", payload: detail as Record<string, unknown> });
    return set({ status: "payment_failed" });
  }
}

/**
 * The store says it has shipped a reserved order. The gateway takes the money now and returns the signed capture
 * record. The store proves it is the right party by presenting the authorization id it was sent.
 */
export async function captureOnShipment(a: { purchaseId: string; authorizationId: string; tracking?: string | null }) {
  const [p] = await db.select().from(purchases).where(eq(purchases.id, a.purchaseId));
  if (!p || !p.product || !p.merchantId || !p.paypalAuthorizationId || p.paypalAuthorizationId !== a.authorizationId) throw new Error("No reserved purchase matches");
  const [m] = await db.select().from(merchants).where(eq(merchants.id, p.merchantId));
  if (p.status === "captured" && p.paypalCaptureId) {
    // Already charged (the store retried): hand back the same record.
    const [e] = await db.select().from(schema.ledger).where(and(eq(schema.ledger.purchaseId, p.id), eq(schema.ledger.type, "payment.captured"))).limit(1);
    return { entry: e, captureId: p.paypalCaptureId };
  }
  if (p.status !== "authorized") throw new Error(`This purchase is ${p.status.replace(/_/g, " ")}, so it cannot be charged`);
  const cap = await captureHold(a.authorizationId, `ship-${p.id}`);
  if (cap.status !== "COMPLETED" && cap.status !== "PENDING") throw new Error(`PayPal did not capture the reservation (${cap.status})`);
  const entry = await append({ userId: p.userId, purchaseId: p.id, type: "payment.captured", payload: {
    paypalOrderId: p.paypalOrderId, paypalCaptureId: cap.id, paypalAuthorizationId: a.authorizationId, chargedOnShipment: true, tracking: a.tracking ?? null,
    amountCents: p.amountCents, currency: p.currency, merchant: { id: m.id, name: m.name, baseUrl: m.baseUrl }, sku: p.product.sku, productName: p.product.name, quantity: p.quantity } });
  await db.update(purchases).set({ status: "captured", paypalCaptureId: cap.id, updatedAt: new Date() }).where(eq(purchases.id, p.id));
  await notify(p.userId, { kind: "charged", title: `${m.name} shipped your order`, detail: `${money(p.amountCents, p.currency)} was charged for ${p.product.name}.`, url: `${appUrl()}/purchases/${p.id}` }).catch(() => {});
  return { entry, captureId: cap.id };
}

/** The buyer cancels a reserved purchase before it ships. The store releases the reservation; nothing is charged. */
export async function cancelHold(userId: string, purchaseId: string) {
  const [p] = await db.select().from(purchases).where(and(eq(purchases.id, purchaseId), eq(purchases.userId, userId)));
  if (!p || p.status !== "authorized" || !p.paypalAuthorizationId || !p.merchantId) throw new Error("This purchase is not waiting to ship, so there is nothing to cancel");
  const [m] = await db.select().from(merchants).where(eq(merchants.id, p.merchantId));
  if (!m.ordersUrl) throw new Error("This store cannot be asked to release the reservation");
  let reply: { voided?: boolean; reason?: string };
  try {
    const res = await fetch(`${m.ordersUrl}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purchaseId: p.id, authorizationId: p.paypalAuthorizationId }), signal: AbortSignal.timeout(30_000) });
    reply = await res.json();
  } catch (e) { throw new Error(`The store could not be reached: ${e instanceof Error ? e.message : e}`); }
  if (!reply.voided) throw new Error(reply.reason ?? "The store did not release the reservation. It may already have shipped.");
  await append({ userId, purchaseId, type: "payment.voided", payload: { paypalAuthorizationId: p.paypalAuthorizationId, by: m.name, at: "the buyer's request" } });
  const [row] = await db.update(purchases).set({ status: "cancelled", updatedAt: new Date() }).where(eq(purchases.id, p.id)).returning();
  return row;
}

/** The one-tap approval. Limits are re-checked in code: approval never lifts the mandate's ceiling. */
export async function decideApproval(userId: string, purchaseId: string, approve: boolean) {
  const result = await db.transaction(async (t) => {
    await lockUser(t, userId);
    const [p] = await t.select().from(purchases).where(and(eq(purchases.id, purchaseId), eq(purchases.userId, userId)));
    if (!p || p.status !== "pending_approval") throw new Error("Nothing to approve");
    const upd = async (status: "declined" | "paying" | "blocked", decision?: Decision) =>
      (await t.update(purchases).set({ status, updatedAt: new Date(), approvalToken: null, ...(decision ? { decision } : {}) }).where(eq(purchases.id, p.id)).returning())[0];
    if (!approve) {
      await append({ userId, purchaseId, type: "purchase.declined_by_user", payload: {} }, t);
      return upd("declined");
    }
    const [mRaw] = p.mandateId ? await t.select().from(mandates).where(eq(mandates.id, p.mandateId)) : [];
    const m = mRaw ? withRules(mRaw) : null;
    const [u] = await t.select().from(users).where(eq(users.id, userId));
    const [a] = await t.select().from(agents).where(eq(agents.id, p.agentId));
    const spend = m ? await committedSpend(t, m.id, { excludePurchaseId: p.id, merchantId: p.merchantId }) : null;
    const why = u?.frozenAt ? "all agent spending is frozen"
      : a?.revokedAt ? "the agent's key was revoked"
      : !m || m.status !== "active" ? "the mandate was revoked"
      : new Date() >= new Date(m.rules.expiresAt) ? "the mandate has expired"
      : p.amountCents > m.rules.totalLimitCents - spend!.committedCents ? "the mandate is out of budget"
      : m.rules.dailyLimitCents != null && p.amountCents > m.rules.dailyLimitCents - spend!.todayCents ? "today's limit is used up"
      : m.rules.perMerchantLimitCents != null && p.amountCents > m.rules.perMerchantLimitCents - spend!.merchantCents ? "the limit for this merchant is used up"
      : null;
    if (why) {
      const decision: Decision = { ...p.decision, outcome: "block", reason: `Approved by the user, but ${why}.` };
      await append({ userId, purchaseId, type: "purchase.decided", payload: decision }, t);
      return upd("blocked", decision);
    }
    await append({ userId, purchaseId, type: "purchase.approved_by_user", payload: { amountCents: p.amountCents } }, t);
    return upd("paying");
  });
  return result.status === "paying" ? pay(result.id) : result;
}

/** Approve or decline through the secret link the agent passes to the user. The token is the credential. */
export async function purchaseByApprovalToken(token: string) {
  if (!token || token.length < 16) return null;
  const [p] = await db.select().from(purchases).where(eq(purchases.approvalToken, token));
  return p ?? null;
}
export async function decideByToken(token: string, approve: boolean) {
  const p = await purchaseByApprovalToken(token);
  if (!p) throw new Error("This approval link is no longer valid");
  return decideApproval(p.userId, p.id, approve);
}

// ---- After the purchase: problems, settlement, refunds, disputes ------------------------------

type MerchantReply =
  | { decision: "refunded"; refundId: string; amountCents: number; reason?: string }
  | { decision: "replacement"; sku: string; tracking?: string; reason?: string }
  | { decision: "offer"; offer: SettlementOffer }
  | { decision: "declined"; reason: string };

async function askMerchant(url: string | null, body: unknown): Promise<MerchantReply> {
  if (!url) return { decision: "declined", reason: "This merchant has no returns endpoint registered with the gateway" };
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(40_000) });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error ?? `merchant returned ${res.status}`);
    return j as MerchantReply;
  } catch (e) { return { decision: "declined", reason: `The merchant could not be reached: ${e instanceof Error ? e.message : e}` }; }
}
const turn = (by: SettlementTurn["by"], action: SettlementTurn["action"], note: string, offer?: SettlementOffer): SettlementTurn => ({ by, action, note, offer, at: new Date().toISOString() });
const describeOffer = (o: SettlementOffer, p: Purchase) =>
  o.type === "replacement" ? `a replacement (${o.sku ?? "same item"})` : o.type === "full_refund" ? "a full refund" : `a partial refund of ${money(o.amountCents ?? 0, p.currency)} (${Math.round(((o.amountCents ?? 0) / p.amountCents) * 100)}% of the price)`;

/** Apply a merchant's final answer to the gateway's own records. */
async function settle(p: Purchase, caseId: string, m: { name: string }, reply: MerchantReply, transcript: SettlementTurn[]) {
  const userId = p.userId, purchaseId = p.id;
  if (reply.decision === "refunded") {
    const full = p.refundedCents + reply.amountCents >= p.amountCents;
    transcript.push(turn("merchant_agent", "refund", `${m.name} refunded ${money(reply.amountCents, p.currency)} through PayPal${reply.reason ? `: ${reply.reason}` : ""}`));
    await append({ userId, purchaseId, type: "refund.completed", payload: { caseId, paypalRefundId: reply.refundId, amountCents: reply.amountCents, full, by: m.name } });
    await db.update(purchases).set({ status: full ? "refunded" : "partially_refunded", paypalRefundId: reply.refundId, refundedCents: p.refundedCents + reply.amountCents, updatedAt: new Date() }).where(eq(purchases.id, p.id));
    const [row] = await db.update(cases).set({ status: full ? "refunded" : "settled", merchantResponse: reply, paypalRefundId: reply.refundId, pendingOffer: null, transcript, updatedAt: new Date() }).where(eq(cases.id, caseId)).returning();
    return { case: row, message: `${m.name} refunded ${money(reply.amountCents, p.currency)} to your PayPal account${full ? "" : `, and you keep the item`}.` };
  }
  if (reply.decision === "replacement") {
    transcript.push(turn("merchant_agent", "accept", `${m.name} is sending a replacement${reply.tracking ? ` (tracking ${reply.tracking})` : ""}`));
    await append({ userId, purchaseId, type: "settlement.accepted", payload: { caseId, replacement: reply.sku, tracking: reply.tracking ?? null } });
    await db.update(purchases).set({ status: "captured", updatedAt: new Date() }).where(eq(purchases.id, p.id));
    const [row] = await db.update(cases).set({ status: "settled", merchantResponse: reply, pendingOffer: null, transcript, updatedAt: new Date() }).where(eq(cases.id, caseId)).returning();
    return { case: row, message: `${m.name} is sending a replacement${reply.tracking ? `, tracking ${reply.tracking}` : ""}.` };
  }
  const reason = reply.decision === "declined" ? reply.reason : "The merchant made an offer";
  transcript.push(turn("merchant_agent", "decline", reason));
  await append({ userId, purchaseId, type: "merchant.declined", payload: { caseId, reason } });
  await db.update(purchases).set({ status: p.refundedCents > 0 ? "partially_refunded" : "captured", updatedAt: new Date() }).where(eq(purchases.id, p.id));
  const [row] = await db.update(cases).set({ status: "merchant_declined", merchantResponse: reply, pendingOffer: null, transcript, updatedAt: new Date() }).where(eq(cases.id, caseId)).returning();
  return { case: row, message: `${m.name} declined: ${reason}. You can open a dispute in PayPal's Resolution Center for transaction ${p.paypalCaptureId}; the signed evidence record for this purchase is ready to attach.` };
}

/**
 * The user reports a problem once. The buyer's agent then negotiates with the merchant's agent on the signed record:
 * it asks for a full refund, weighs any counter-offer against the user's settlement rules, counters once, and either
 * closes the case or brings the best offer back to the user.
 */
export async function reportProblem(userId: string, purchaseId: string, report: string) {
  const [p] = await db.select().from(purchases).where(and(eq(purchases.id, purchaseId), eq(purchases.userId, userId)));
  if (!p || !p.merchantId) throw new Error("Purchase not found");
  if (p.status !== "captured") throw new Error(`This purchase is ${p.status.replace(/_/g, " ")}, so there is nothing to refund.`);
  const [m] = await db.select().from(merchants).where(eq(merchants.id, p.merchantId));
  const settings = (await getUser(userId))?.settings ?? {};
  const [c] = await db.insert(cases).values({ id: newId("case"), purchaseId, userId, report, status: "open" }).returning();
  await append({ userId, purchaseId, type: "problem.reported", payload: { caseId: c.id, report } });

  const analysis = await analyseProblem(report, { userRequest: p.userRequest, ordered: { name: p.product?.name, sku: p.product?.sku, description: p.product?.description, priceCents: p.product?.priceCents, quantity: p.quantity, merchant: m.name } });
  const transcript: SettlementTurn[] = [turn("buyer_agent", "ask", `Asked ${m.name} for a full refund of ${money(p.amountCents, p.currency)}: ${analysis.summary}`)];
  await append({ userId, purchaseId, type: "refund.requested", payload: { caseId: c.id, merchant: m.name, claim: analysis } });
  await db.update(purchases).set({ status: "refund_requested", updatedAt: new Date() }).where(eq(purchases.id, p.id));
  await db.update(cases).set({ analysis, status: "refund_requested" }).where(eq(cases.id, c.id));

  const evidence = await evidenceBundle(purchaseId);
  const base = { purchaseId, claim: analysis, report, evidence };
  let reply = await askMerchant(m.returnsUrl, { ...base, ask: { type: "full_refund" } });

  const wantPct = Math.min(100, Math.max(1, settings.autoAcceptRefundPercent ?? 100));
  const acceptable = (o: SettlementOffer) =>
    o.type === "full_refund" || (o.type === "replacement" ? !!settings.autoAcceptReplacement : ((o.amountCents ?? 0) / p.amountCents) * 100 >= wantPct);

  if (reply.decision === "offer") {
    transcript.push(turn("merchant_agent", "offer", `${m.name} offered ${describeOffer(reply.offer, p)}: ${reply.offer.reason}`, reply.offer));
    await append({ userId, purchaseId, type: "settlement.offer", payload: { caseId: c.id, offer: reply.offer } });
    // One counter: ask for what the user's rule would accept, or half when the user wants to decide personally.
    if (!acceptable(reply.offer) && reply.offer.type === "partial_refund") {
      const askCents = Math.round((p.amountCents * (wantPct < 100 ? wantPct : 50)) / 100);
      if (askCents > (reply.offer.amountCents ?? 0)) {
        transcript.push(turn("buyer_agent", "counter", `Countered: asked for ${money(askCents, p.currency)} (${Math.round((askCents / p.amountCents) * 100)}%)`));
        await append({ userId, purchaseId, type: "settlement.counter", payload: { caseId: c.id, askCents } });
        const second = await askMerchant(m.returnsUrl, { ...base, ask: { type: "partial_refund", amountCents: askCents } });
        if (second.decision === "offer") {
          transcript.push(turn("merchant_agent", "offer", `${m.name} came back with ${describeOffer(second.offer, p)}: ${second.offer.reason}`, second.offer));
          await append({ userId, purchaseId, type: "settlement.offer", payload: { caseId: c.id, offer: second.offer } });
        }
        if (second.decision !== "declined") reply = second;
      }
    }
  }

  if (reply.decision === "offer") {
    const offer = reply.offer;
    if (acceptable(offer)) {
      transcript.push(turn("buyer_agent", "accept", `Accepted ${describeOffer(offer, p)} under the user's settlement rules`));
      await append({ userId, purchaseId, type: "settlement.accepted", payload: { caseId: c.id, offer, by: "buyer agent, within the user's rules" } });
      return settle(p, c.id, m, await askMerchant(m.returnsUrl && `${m.returnsUrl}/accept`, { purchaseId, offerId: offer.id }), transcript);
    }
    const [row] = await db.update(cases).set({ status: "offer_pending", pendingOffer: offer, merchantResponse: reply, transcript, updatedAt: new Date() }).where(eq(cases.id, c.id)).returning();
    await notify(userId, { kind: "offer_waiting", title: `${m.name} made an offer`, detail: `${describeOffer(offer, p)}: ${offer.reason}`, url: `${appUrl()}/purchases/${p.id}` });
    return { case: row, message: `${m.name} offered ${describeOffer(offer, p)}: ${offer.reason} This is below what you told the gateway to accept automatically, so it is waiting for your decision.` };
  }
  return settle(p, c.id, m, reply, transcript);
}

/** The user's answer to an offer that was outside their automatic rules. */
export async function answerOffer(userId: string, caseId: string, accept: boolean) {
  const [c] = await db.select().from(cases).where(and(eq(cases.id, caseId), eq(cases.userId, userId)));
  if (!c || c.status !== "offer_pending" || !c.pendingOffer) throw new Error("There is no offer waiting on this case");
  const [p] = await db.select().from(purchases).where(eq(purchases.id, c.purchaseId));
  const [m] = await db.select().from(merchants).where(eq(merchants.id, p.merchantId!));
  const transcript = [...(c.transcript ?? [])];
  if (!accept) {
    transcript.push(turn("user", "decline", `Declined ${describeOffer(c.pendingOffer, p)}`));
    await append({ userId, purchaseId: p.id, type: "settlement.declined", payload: { caseId, offer: c.pendingOffer } });
    return settle(p, caseId, m, { decision: "declined", reason: "the buyer declined the merchant's offer" }, transcript);
  }
  transcript.push(turn("user", "accept", `Accepted ${describeOffer(c.pendingOffer, p)}`));
  await append({ userId, purchaseId: p.id, type: "settlement.accepted", payload: { caseId, offer: c.pendingOffer, by: "the user" } });
  return settle(p, caseId, m, await askMerchant(m.returnsUrl && `${m.returnsUrl}/accept`, { purchaseId: p.id, offerId: c.pendingOffer.id }), transcript);
}

/** Apply a PayPal webhook to the gateway's records. */
export async function applyWebhook(eventType: string, resource: Record<string, unknown>) {
  const find = async (captureId: string | undefined) => captureId ? (await db.select().from(purchases).where(eq(purchases.paypalCaptureId, captureId)))[0] : undefined;
  if (eventType === "PAYMENT.CAPTURE.REFUNDED") {
    const up = (resource.links as { rel: string; href: string }[] | undefined)?.find((l) => l.rel === "up")?.href;
    const p = await find(up?.split("/").pop());
    // The merchant's own reply normally records the refund first; this covers refunds made outside the gateway.
    if (p && p.paypalRefundId !== String(resource.id) && p.status !== "refunded" && p.status !== "partially_refunded") {
      const cents = Math.round(Number((resource.amount as { value?: string } | undefined)?.value ?? 0) * 100) || p.amountCents;
      const full = p.refundedCents + cents >= p.amountCents;
      await db.update(purchases).set({ status: full ? "refunded" : "partially_refunded", refundedCents: p.refundedCents + cents, paypalRefundId: String(resource.id), updatedAt: new Date() }).where(eq(purchases.id, p.id));
      await append({ userId: p.userId, purchaseId: p.id, type: "refund.completed", payload: { paypalRefundId: resource.id, amountCents: cents, confirmedBy: "paypal webhook" } });
    }
    return p?.id ?? null;
  }
  if (eventType.startsWith("CUSTOMER.DISPUTE.")) {
    const txs = (resource.disputed_transactions as { seller_transaction_id?: string; buyer_transaction_id?: string }[] | undefined) ?? [];
    const p = (await find(txs[0]?.seller_transaction_id)) ?? (await find(txs[0]?.buyer_transaction_id));
    if (p) {
      const resolved = eventType === "CUSTOMER.DISPUTE.RESOLVED";
      const outcome = (resource.dispute_outcome as { outcome_code?: string } | undefined)?.outcome_code ?? null;
      await db.update(purchases).set({ status: resolved && outcome?.includes("BUYER") ? "refunded" : resolved ? "captured" : "disputed", updatedAt: new Date() }).where(eq(purchases.id, p.id));
      await append({ userId: p.userId, purchaseId: p.id, type: "dispute.opened", payload: { event: eventType, disputeId: resource.dispute_id, reason: resource.reason, status: resource.status, outcome } });
    }
    return p?.id ?? null;
  }
  return null;
}

export type { ProductSnapshot };
