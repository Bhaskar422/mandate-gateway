import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { activeMandate, agentFromKey, committedSpend, reportProblem, requestPurchase } from "@/lib/gateway";
import { money } from "@/lib/ids";
import { appUrl } from "@/lib/config";

export const maxDuration = 60;
type Agent = NonNullable<Awaited<ReturnType<typeof agentFromKey>>>;
const out = (o: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(o, null, 2) }] });

function describe(p: typeof schema.purchases.$inferSelect) {
  const amount = p.product ? money(p.amountCents, p.currency) : null;
  const base = { purchase_id: p.id, status: p.status, product: p.product?.name ?? null, amount, record: `${appUrl()}/purchases/${p.id}` };
  switch (p.status) {
    case "captured": return { ...base, message: `Paid. ${amount} was charged to the user's PayPal account. PayPal order ${p.paypalOrderId}.` };
    case "blocked": return { ...base, message: `BLOCKED by the user's mandate: ${p.decision.reason} This decision is final for this product. Do not try to work around it; tell the user what was blocked and why.` };
    case "pending_approval": return { ...base, message: `Waiting for the user's approval: ${p.decision.reason} Ask the user to approve it in their Mandate dashboard at ${appUrl()}, then call check_status.` };
    case "payment_failed": return { ...base, message: "The purchase was approved but PayPal did not complete the payment. Nothing was charged." };
    case "declined": return { ...base, message: "The user declined this purchase." };
    case "refunded": return { ...base, message: "This purchase was refunded to the user's PayPal account." };
    default: return { ...base, message: `Status: ${p.status}.` };
  }
}

const build = (agent: Agent) => createMcpHandler((server) => {
  server.registerTool("get_mandate", {
    title: "Get spending mandate",
    description: "Read what the user has authorised you to buy: budget remaining, allowed categories, merchant rules, approval threshold and expiry. Call this before shopping.",
    inputSchema: z.object({}),
  }, async () => {
    const m = await activeMandate(agent.userId);
    if (!m) return out({ active: false, message: `The user has no active mandate. Ask them to set one at ${appUrl()}.` });
    const spend = await committedSpend(db, m.id);
    return out({ active: true, summary: m.rules.summary, currency: m.rules.currency,
      remaining: money(m.rules.totalLimitCents - spend.committedCents, m.rules.currency), total_limit: money(m.rules.totalLimitCents, m.rules.currency),
      per_purchase_limit: m.rules.perPurchaseLimitCents === null ? null : money(m.rules.perPurchaseLimitCents, m.rules.currency),
      needs_user_approval_above: m.rules.approvalThresholdCents === null ? null : money(m.rules.approvalThresholdCents, m.rules.currency),
      allowed_categories: m.rules.allowedCategories, merchants: m.rules.merchantPolicy === "allowlist" ? m.rules.allowedMerchants : m.rules.merchantPolicy, expires_at: m.rules.expiresAt });
  });

  server.registerTool("request_purchase", {
    title: "Request a purchase",
    description: "Ask the gateway to buy one product for the user with their PayPal account. You never handle payment details. The gateway reads the product page itself, checks the purchase against the user's mandate, and then pays, asks the user, or blocks it with a reason.",
    inputSchema: z.object({
      product_url: z.string().describe("The product page URL on the merchant's site"),
      quantity: z.number().int().min(1).max(20).default(1),
      expected_price: z.number().positive().describe("The unit price you saw, in the product's currency, e.g. 89.00"),
      user_request: z.string().min(3).describe("What the user asked you for, in their own words"),
      reason: z.string().optional().describe("Why this product fits the request"),
    }),
  }, async (a) => out(describe(await requestPurchase(agent, {
    productUrl: a.product_url, quantity: a.quantity, expectedPriceCents: Math.round(a.expected_price * 100), userRequest: a.user_request, reason: a.reason ?? null }))));

  const own = async (id: string) => (await db.select().from(schema.purchases).where(eq(schema.purchases.id, id)))[0];
  server.registerTool("check_status", {
    title: "Check a purchase",
    description: "Get the current status of a purchase you requested, e.g. after the user approves one.",
    inputSchema: z.object({ purchase_id: z.string() }),
  }, async ({ purchase_id }) => {
    const p = await own(purchase_id);
    return p && p.userId === agent.userId ? out(describe(p)) : out({ error: "No such purchase" });
  });

  server.registerTool("report_problem", {
    title: "Report a problem with a purchase",
    description: "Tell the gateway something went wrong with a completed purchase (wrong item, not received, damaged). The gateway sends the merchant the signed record of what was ordered and pursues a refund.",
    inputSchema: z.object({ purchase_id: z.string(), description: z.string().min(5).describe("What the user says went wrong, in their own words") }),
  }, async ({ purchase_id, description }) => {
    try { const r = await reportProblem(agent.userId, purchase_id, description); return out({ case_id: r.case.id, status: r.case.status, message: r.message }); }
    catch (e) { return out({ error: e instanceof Error ? e.message : String(e) }); }
  });
}, { serverInfo: { name: "mandate-gateway", version: "1.0.0" } });

async function handler(req: Request) {
  const url = new URL(req.url);
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
  const agent = await agentFromKey(key);
  if (!agent) return Response.json({ error: "Unknown or revoked agent key. Create one in the Mandate dashboard." }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  return build(agent)(req);
}
export { handler as GET, handler as POST, handler as DELETE };
