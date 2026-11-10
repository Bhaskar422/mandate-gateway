// End-to-end check of every demo path against a running dev server.
// User-side steps call the library directly; agent-side steps go over MCP exactly as a real agent would.
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { confirmMandate, createAgent, decideApproval } from "../src/lib/gateway";
import { verifyChain } from "../src/lib/ledger";
import { shipOrder } from "../src/lib/stores/merchant";
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
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`); };

async function main() {
  const userId = newId("usr_e2e");
  await db.insert(schema.users).values({ id: userId });
  await db.insert(schema.paypalLinks).values({ userId, vaultId: process.env.E2E_VAULT_ID ?? "SIM-VAULT-E2E", status: "active", payerEmail: "e2e@example.com" });
  await confirmMandate(userId, "Up to $150 on running shoes, known merchants only, ask me above $100.", {
    summary: "Up to $150 on running shoes from verified merchants; ask above $100.", currency: "USD", totalLimitCents: 15000, perPurchaseLimitCents: null,
    approvalThresholdCents: 10000, allowedCategories: ["running shoes"], merchantPolicy: "verified_only", allowedMerchants: [], maxPurchases: null,
    expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() });
  const { key } = await createAgent(userId, "e2e agent");
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
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
