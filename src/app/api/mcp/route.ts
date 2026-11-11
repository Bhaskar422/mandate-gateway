import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { mandateCredential, mandateView, previewPurchase, purchaseStatus, submitProblem, submitPurchase } from "@/lib/agent-api";
import { agentFromKey } from "@/lib/gateway";

export const maxDuration = 60;
type Agent = NonNullable<Awaited<ReturnType<typeof agentFromKey>>>;
const out = (o: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(o, null, 2) }] });

const purchaseShape = {
  product_url: z.string().describe("The product page URL on the merchant's site"),
  quantity: z.number().int().min(1).max(20).default(1),
  expected_price: z.number().positive().describe("The unit price you saw, in the product's currency, e.g. 89.00"),
  user_request: z.string().min(3).describe("What the user asked you for, in their own words"),
  reason: z.string().optional().describe("Why this product fits the request"),
};

const build = (agent: Agent) => createMcpHandler((server) => {
  server.registerTool("get_mandate", {
    title: "Get spending mandate",
    description: "Read what the user has authorised you to buy: budget remaining, allowed categories, merchant rules, approval threshold and expiry. Call this before shopping.",
    inputSchema: z.object({}),
  }, async () => out(await mandateView(agent)));

  server.registerTool("get_credential", {
    title: "Get a credential to show a store",
    description: "Get a short-lived signed statement of what the user's mandate allows: budget left, limits, categories and store rules. Show it to a store (its present_mandate tool or its mandate endpoint) to learn which of its products fit. The store checks it offline with the gateway's public key. Pass store_url to bind it to one store; a store rejects a credential issued for another. It holds no payment details and authorises nothing by itself: buying still goes through request_purchase.",
    inputSchema: z.object({ store_url: z.string().max(300).optional().describe("The store's base address, e.g. https://shop.example. The credential then works at that store only.") }),
  }, async ({ store_url }) => out(await mandateCredential(agent, store_url)));

  server.registerTool("check_purchase", {
    title: "Check a purchase without buying",
    description: "A dry run. Ask whether a purchase would be paid, need the user's approval, or be blocked, and why. Nothing is charged or recorded. Use it when you are unsure a product fits the mandate.",
    inputSchema: z.object(purchaseShape),
  }, async (a) => out(await previewPurchase(agent, a)));

  server.registerTool("request_purchase", {
    title: "Request a purchase",
    description: "Ask the gateway to buy one product for the user with their PayPal account. You never handle payment details. The gateway reads the product page itself, checks the purchase against the user's mandate, and then pays, asks the user, or blocks it with a reason. Safe to retry: repeating the same request returns the purchase already made.",
    inputSchema: z.object({ ...purchaseShape, idempotency_key: z.string().max(120).optional().describe("Any string unique to this purchase attempt. Send the same key when retrying so the user is never charged twice.") }),
  }, async (a) => out(await submitPurchase(agent, a)));

  server.registerTool("check_status", {
    title: "Check a purchase",
    description: "Get the current status of a purchase you requested, e.g. after the user approves one.",
    inputSchema: z.object({ purchase_id: z.string() }),
  }, async ({ purchase_id }) => out((await purchaseStatus(agent, purchase_id)) ?? { error: "No such purchase" }));

  server.registerTool("report_problem", {
    title: "Report a problem with a purchase",
    description: "Tell the gateway something went wrong with a completed purchase (wrong item, not received, damaged, changed mind). The gateway sends the merchant the signed record of what was ordered and negotiates a refund, partial refund or replacement within the user's settlement rules.",
    inputSchema: z.object({ purchase_id: z.string(), description: z.string().min(5).describe("What the user says went wrong, in their own words") }),
  }, async ({ purchase_id, description }) => out(await submitProblem(agent, purchase_id, description)));
}, { serverInfo: { name: "mandate-gateway", version: "1.1.0" } });

async function handler(req: Request) {
  const url = new URL(req.url);
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
  const agent = await agentFromKey(key);
  if (!agent) return Response.json({ error: "Unknown or revoked agent key. Create one in the Mandate dashboard." }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  return build(agent)(req);
}
export { handler as GET, handler as POST, handler as DELETE };
