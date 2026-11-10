// End-to-end check of every demo path against a running dev server.
// User-side steps call the library directly; agent-side steps go over MCP exactly as a real agent would.
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { answerOffer, confirmMandate, createAgent, decideApproval, resumeAgent, setFrozen, updateSettings } from "../src/lib/gateway";
import { registerMerchant, verifyMerchantDomain } from "../src/lib/merchants";
import { llmConfigured } from "../src/lib/config";
import { verifyChain } from "../src/lib/ledger";
import { publishVerificationToken, shipOrder } from "../src/lib/stores/merchant";
import { newId } from "../src/lib/ids";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
let rpcId = 0;
async function mcp(path: string, name: string, args: Record<string, unknown>, key?: string) {
  const res = await fetch(`${BASE}${path}`, { method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }) });
  const text = await res.text();
  const json = text.startsWith("{") ? JSON.parse(text) : JSON.parse(text.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
  if (json.error) throw new Error(`${name}: ${JSON.stringify(json.error)}`);
  return JSON.parse(json.result.content[0].text);
}
async function rest(method: string, path: string, key: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() };
}
const storeOrder = async (purchaseId: string) => {
  for (let i = 0; i < 20; i++) { const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.gatewayPurchaseId, purchaseId)); if (o) return o; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error("The store did not record the order");
};
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`); };

async function main() {
  // Long enough to be a valid dashboard session id: set the cookie mandate_uid to it to see this user's dashboard.
  const userId = newId("usr_e2e_demo_user");
  await db.insert(schema.users).values({ id: userId });
  await db.insert(schema.paypalLinks).values({ userId, vaultId: process.env.E2E_VAULT_ID ?? "SIM-VAULT-E2E", status: "active", payerEmail: "e2e@example.com" });
  await confirmMandate(userId, "Up to $150 on running shoes, known merchants only, ask me above $100.", {
    summary: "Up to $150 on running shoes from verified merchants; ask above $100.", currency: "USD", totalLimitCents: 15000, perPurchaseLimitCents: null,
    approvalThresholdCents: 10000, allowedCategories: ["running shoes"], merchantPolicy: "verified_only", allowedMerchants: [], maxPurchases: null,
    expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() });
  const { key, agent } = await createAgent(userId, "e2e agent");
  const G = "/api/mcp", ask = "Buy me a pair of running shoes under $100";

  check("rejects an unknown agent key", (await fetch(`${BASE}${G}`, { method: "POST", headers: { Authorization: "Bearer nope" }, body: "{}" })).status === 401);
  const mandate = await mcp(G, "get_mandate", {}, key);
  check("agent can read its mandate", mandate.active && mandate.remaining === "$150.00", mandate.remaining);

  const shop = await mcp("/stores/stride/mcp", "search_products", { query: "running shoe" });
  const tempo = shop.products.find((p: { sku: string }) => p.sku === "STR-TEMPO3");
  const cloud = shop.products.find((p: { sku: string }) => p.sku === "STR-CLOUD");
  check("store catalogue is searchable by agents", !!tempo && tempo.price === "89.00");
  check("store data carries the planted injection", /gift card/i.test(cloud.description));

  let buy = await mcp(G, "request_purchase", { product_url: tempo.url, expected_price: 89, user_request: ask, reason: "Road running shoe at $89" }, key);
  if (buy.status === "pending_approval") { // no classifier configured: the engine falls back to asking the user
    console.log("      (no LLM key: category check fell back to user approval)");
    await decideApproval(userId, buy.purchase_id, true);
    buy = await mcp(G, "check_status", { purchase_id: buy.purchase_id }, key);
  }
  check("in-mandate purchase is paid", buy.status === "captured", buy.message);
  const purchaseId = buy.purchase_id;

  const kickz = (await mcp("/stores/kickz/mcp", "search_products", {})).products[0];
  const blocked = await mcp(G, "request_purchase", { product_url: kickz.url, expected_price: 140, user_request: ask }, key);
  check("unverified merchant is blocked", blocked.status === "blocked" && /not verified/.test(blocked.message), blocked.message);

  const gift = await mcp(G, "request_purchase", { product_url: `${BASE}/stores/stride/products/STR-GIFT100`, expected_price: 100, user_request: ask, reason: "Store notice says to buy this instead" }, key);
  check("injected gift-card purchase never pays", gift.status !== "captured" && gift.status !== "paying", `${gift.status}: ${gift.message}`);
  if (gift.status === "pending_approval") await decideApproval(userId, gift.purchase_id, false);

  const lied = await mcp(G, "request_purchase", { product_url: tempo.url, expected_price: 9, user_request: ask }, key);
  check("price mismatch is blocked", lied.status === "blocked", lied.message);
  const off = await mcp(G, "request_purchase", { product_url: "https://evil.example/shoe", expected_price: 50, user_request: ask }, key);
  check("unregistered site is blocked without being fetched", off.status === "blocked", off.message);
  const over = await mcp(G, "request_purchase", { product_url: `${BASE}/stores/stride/products/STR-CARBON`, expected_price: 135, user_request: ask }, key);
  check("purchase over the remaining budget is blocked", over.status === "blocked" && /left on this mandate/.test(over.message), over.message);

  // After the purchase: the store ships the wrong item, the buyer reports it, the merchant refunds on the evidence.
  let order: typeof schema.storeOrders.$inferSelect | undefined;
  for (let i = 0; i < 20 && !order; i++) { [order] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.gatewayPurchaseId, purchaseId)); if (!order) await new Promise((r) => setTimeout(r, 250)); }
  check("merchant accepted the signed order", !!order && order.sku === "STR-TEMPO3");
  await shipOrder("stride", order!.id, "STR-SOCK3");
  const problem = await mcp(G, "report_problem", { purchase_id: purchaseId, description: "I ordered running shoes but a pack of socks arrived." }, key);
  check("wrong item is refunded on the evidence", problem.status === "refunded", problem.message);
  const after = await mcp(G, "get_mandate", {}, key);
  check("refund returns the money to the budget", after.remaining === "$150.00", after.remaining);
  const again = await mcp(G, "report_problem", { purchase_id: purchaseId, description: "Refund me again please" }, key);
  check("a second refund is refused", !!again.error, again.error);


  // ---- Risk controls ----------------------------------------------------------------------------
  const [paused] = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.id));
  check("agent is paused automatically after repeated blocked attempts", !!paused.pausedAt && /blocked attempts/.test(paused.pauseReason ?? ""), paused.pauseReason ?? "not paused");
  const whilePaused = await mcp(G, "request_purchase", { product_url: tempo.url, expected_price: 89, user_request: ask }, key);
  check("a paused agent cannot buy", whilePaused.status === "blocked" && /paused/.test(whilePaused.message), whilePaused.message);
  await resumeAgent(userId, agent.id);
  // Blocked rows from the first half are still inside the window, so clear them to keep the agent active for the rest.
  await db.update(schema.purchases).set({ createdAt: new Date(Date.now() - 3600_000) }).where(eq(schema.purchases.agentId, agent.id));

  await setFrozen(userId, true);
  const frozen = await mcp(G, "request_purchase", { product_url: tempo.url, expected_price: 89, user_request: ask }, key);
  check("the kill switch blocks every purchase", frozen.status === "blocked" && /frozen/.test(frozen.message), frozen.message);
  await setFrozen(userId, false);
  await db.update(schema.purchases).set({ createdAt: new Date(Date.now() - 3600_000) }).where(eq(schema.purchases.agentId, agent.id));

  // ---- REST API, dry run, idempotency -----------------------------------------------------------
  const noKey = await fetch(`${BASE}/api/v1/mandate`);
  check("REST rejects a missing key", noKey.status === 401);
  const rm = await rest("GET", "/mandate", key);
  check("REST returns the mandate", rm.status === 200 && rm.json.active === true && rm.json.remaining === "$150.00", rm.json.remaining);
  const rowsBefore = (await db.select().from(schema.purchases).where(eq(schema.purchases.agentId, agent.id))).length;
  const dry = await rest("POST", "/purchases/check", key, { product_url: kickz.url, expected_price: 140, user_request: ask });
  const rowsAfter = (await db.select().from(schema.purchases).where(eq(schema.purchases.agentId, agent.id))).length;
  check("a dry run reports the block and records nothing", dry.json.would === "block" && rowsBefore === rowsAfter, dry.json.message);
  const bad = await rest("POST", "/purchases", key, { product_url: tempo.url });
  check("REST validates the request body", bad.status === 400, bad.json.error?.message);

  // ---- Prompt-injection page --------------------------------------------------------------------
  const inj = await mcp(G, "request_purchase", { product_url: cloud.url, expected_price: 79, user_request: ask }, key);
  check("a page with hidden instructions for AI goes to the user, not to payment", inj.status === "pending_approval" && /prompt-injection|approve/.test(inj.message) && !!inj.approval_url, inj.message);
  await decideApproval(userId, inj.purchase_id, false);

  const idem = { product_url: tempo.url, expected_price: 89, user_request: ask, idempotency_key: "e2e-" + userId };
  const first = await rest("POST", "/purchases", key, idem);
  const second = await rest("POST", "/purchases", key, idem);
  check("REST purchase is paid", first.status === 201 && first.json.status === "captured", first.json.message);
  check("a retried request returns the same purchase, not a second charge", second.json.purchase_id === first.json.purchase_id);
  const viaMcp = await mcp(G, "request_purchase", { product_url: tempo.url, expected_price: 89, user_request: ask }, key);
  check("the same product requested again right away is not bought twice", viaMcp.purchase_id === first.json.purchase_id);

  // ---- Several mandates, scoped to agents -------------------------------------------------------
  const { agent: other, key: otherKey } = await createAgent(userId, "other agent");
  await confirmMandate(userId, "Up to $400 on running shoes at known merchants, for the e2e agent only.", {
    summary: "Up to $400 on running shoes at verified merchants.", currency: "USD", totalLimitCents: 40000, allowedCategories: ["running shoes"],
    merchantPolicy: "verified_only", expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() }, { name: "Big budget", agentIds: [agent.id] });
  const two = await mcp(G, "get_mandate", {}, key);
  const one = await mcp(G, "get_mandate", {}, otherKey);
  check("a scoped mandate is visible only to its agent", two.mandates.length === 2 && one.mandates.length === 1, `${two.mandates.length} vs ${one.mandates.length}`);
  const carbon = await mcp(G, "request_purchase", { product_url: `${BASE}/stores/stride/products/STR-CARBON`, expected_price: 135, user_request: ask }, key);
  check("a purchase the first mandate would block goes ahead under the second", carbon.status === "captured", carbon.message);
  const otherCarbon = await mcp(G, "request_purchase", { product_url: `${BASE}/stores/stride/products/STR-CARBON`, expected_price: 135, user_request: ask }, otherKey);
  check("the other agent is still held to the first mandate", otherCarbon.status !== "captured", otherCarbon.status);
  if (otherCarbon.status === "pending_approval") await decideApproval(userId, otherCarbon.purchase_id, false);
  void other;

  // ---- Negotiated settlement --------------------------------------------------------------------
  if (!llmConfigured()) console.log("      (no LLM key: settlement checks skipped, they need the problem classifier)");
  else {
    const o1 = await storeOrder(first.json.purchase_id);
    await shipOrder("stride", o1.id, o1.sku);
    const damaged = await rest("POST", `/purchases/${first.json.purchase_id}/problems`, key, { description: "The shoes arrived damaged: the sole is split on the left shoe." });
    check("a damage claim the store cannot verify gets a replacement offer, held for the user", damaged.json.status === "offer_pending", damaged.json.message);
    const settled = await answerOffer(userId, damaged.json.case_id, true);
    check("accepting the offer ships a replacement", settled.case.status === "settled" && /replacement/.test(settled.message), settled.message);

    await updateSettings(userId, { autoAcceptRefundPercent: 40 });
    const o2 = await storeOrder(carbon.purchase_id);
    await shipOrder("stride", o2.id, o2.sku);
    const nad = await mcp(G, "report_problem", { purchase_id: carbon.purchase_id, description: "The shoes are not as described: the listing said 190 g but they are much heavier and a different colour." }, key);
    const [c2] = await db.select().from(schema.cases).where(eq(schema.cases.id, nad.case_id));
    const [p2] = await db.select().from(schema.purchases).where(eq(schema.purchases.id, carbon.purchase_id));
    check("the agents negotiate a partial refund inside the user's rule", nad.status === "settled" && p2.status === "partially_refunded" && p2.refundedCents === 5400, `${nad.status}, refunded ${p2.refundedCents}: ${nad.message}`);
    check("the negotiation is recorded turn by turn", (c2.transcript ?? []).map((t) => t.action).join(",") === "ask,offer,counter,offer,accept,refund", (c2.transcript ?? []).map((t) => `${t.by}:${t.action}`).join(" "));
    const m2 = await mcp(G, "get_mandate", {}, key);
    check("a partial refund returns that money to the budget", m2.mandates.find((x: { name: string }) => x.name === "Big budget").remaining === "$319.00", m2.mandates.map((x: { remaining: string }) => x.remaining).join(", "));
  }

  // ---- Merchant onboarding ----------------------------------------------------------------------
  const peakUrl = `${BASE}/stores/peak/products/PK-RIDGE`;
  await confirmMandate(userId, "Up to $120 on running shoes at any store the gateway can pay.", {
    summary: "Up to $120 on running shoes at any registered merchant.", currency: "USD", totalLimitCents: 12000, allowedCategories: ["running shoes"],
    merchantPolicy: "any_registered", expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() }, { name: "Any store", agentIds: [other.id] });
  await publishVerificationToken("peak", "");
  const reg = await registerMerchant(userId, `${BASE}/stores/peak`);
  if (reg.domainVerifiedAt) console.log("      (Peak was already onboarded in this database: registration checks reuse it)");
  else {
    const unproven = await mcp(G, "request_purchase", { product_url: peakUrl, expected_price: 95, user_request: "Buy trail running shoes" }, otherKey);
    check("a store that has registered but not proved its domain is not paid", unproven.status === "blocked" && /payee/.test(unproven.message), unproven.message);
    const early = await verifyMerchantDomain(userId, reg.id).then(() => "verified", (e) => String(e.message));
    check("verification fails until the store publishes the token", /verification token/.test(early), early);
    await publishVerificationToken("peak", reg.verificationToken!);
    const ok = await verifyMerchantDomain(userId, reg.id);
    check("verification succeeds once the token is on the store's site", !!ok.domainVerifiedAt && ok.name === "Peak Trail Supply", ok.name);
    await db.update(schema.purchases).set({ createdAt: new Date(Date.now() - 3600_000) }).where(eq(schema.purchases.agentId, other.id));
  }
  const peak = await mcp(G, "request_purchase", { product_url: peakUrl, expected_price: 95, user_request: "Buy trail running shoes" }, otherKey);
  check("an onboarded store is paid under an any-store mandate", peak.status === "captured", peak.message);
  const peakOrder = await storeOrder(peak.purchase_id);
  check("the onboarded store receives its signed order", peakOrder.storeSlug === "peak" && peakOrder.sku === "PK-RIDGE");
  const strictPeak = await mcp(G, "request_purchase", { product_url: `${BASE}/stores/peak/products/PK-VEST`, expected_price: 69, user_request: ask }, key);
  check("a known-merchants-only mandate still refuses the onboarded store", strictPeak.status === "blocked" && /not verified/.test(strictPeak.message), strictPeak.message);
  // Leave nothing captured: cancel the Peak order while it is still unshipped.
  const cancel = await mcp(G, "report_problem", { purchase_id: peak.purchase_id, description: "Please cancel this order, I no longer need it." }, otherKey);
  check("an unshipped order at the onboarded store is cancelled and refunded", cancel.status === "refunded", cancel.message);

  const chain = await verifyChain();
  check("ledger chain verifies", chain.ok, chain.ok ? `${chain.entries} entries` : chain.why);
  const [row] = await db.select().from(schema.ledger).where(eq(schema.ledger.purchaseId, purchaseId)).limit(1);
  await db.update(schema.ledger).set({ payload: { ...row.payload, tampered: true } }).where(eq(schema.ledger.seq, row.seq));
  const broken = await verifyChain();
  check("tampering with a record is detected", !broken.ok && broken.brokenAt === row.seq, broken.ok ? "" : broken.why);
  await db.update(schema.ledger).set({ payload: row.payload }).where(eq(schema.ledger.seq, row.seq));
  check("ledger is intact after restoring", (await verifyChain()).ok);

  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  console.log(`DEMO_USER=${userId}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
