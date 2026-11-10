// The one place (for TypeScript) that knows how to reach the gateway and store MCP servers and
// how the six tools are described to a model. Framework adapters wrap TOOLS as native function tools.
import { z } from "zod";
import type { Recorder } from "./types";

export const STORES = ["stride", "kickz"] as const;
export const mcpUrls = (gatewayUrl: string) => ({
  gateway: `${gatewayUrl}/api/mcp`,
  stride: `${gatewayUrl}/stores/stride/mcp`,
  kickz: `${gatewayUrl}/stores/kickz/mcp`,
});

let rpcId = 0;
/** Bare JSON-RPC `tools/call` against a stateless Streamable HTTP MCP server. Returns the tool's text result. */
export async function mcpCall(url: string, name: string, args: Record<string, unknown>, key?: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  if (!res.ok) return JSON.stringify({ error: `HTTP ${res.status}`, body: text.slice(0, 500) });
  const line = text.startsWith("{") ? text : (text.split("\n").find((l) => l.startsWith("data:")) ?? "").slice(5);
  let json: { error?: unknown; result?: { content?: { type: string; text?: string }[]; isError?: boolean } };
  try { json = JSON.parse(line); } catch { return JSON.stringify({ error: "unparseable MCP response", body: text.slice(0, 500) }); }
  if (json.error) return JSON.stringify({ error: json.error });
  return (json.result?.content ?? []).map((c) => c.text ?? "").join("\n");
}

export type ToolGroup = "store" | "gateway";
export type ToolSpec = {
  name: string; group: ToolGroup; description: string;
  schema: z.ZodObject;
  /** JSON Schema for frameworks that want it raw. */
  jsonSchema: Record<string, unknown>;
  run(args: Record<string, unknown>, env: ToolEnv): Promise<string>;
};
export type ToolEnv = { gatewayUrl: string; agentKey: string; recorder: Recorder; agent?: string; signal?: AbortSignal };

const store = z.enum(STORES).describe('Which store: "stride" (Stride Running Co.) or "kickz" (Kickz Outlet)');
function spec<S extends z.ZodObject>(name: string, group: ToolGroup, description: string, schema: S,
  target: (a: z.infer<S>, env: ToolEnv) => { url: string; args: Record<string, unknown>; key?: string }): ToolSpec {
  const { $schema: _drop, ...jsonSchema } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return {
    name, group, description, schema, jsonSchema,
    async run(raw, env) {
      env.recorder.tool(name, raw, env.agent);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return JSON.stringify({ error: "Invalid arguments", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
      const t = target(parsed.data, env);
      try { return await mcpCall(t.url, name, t.args, t.key, env.signal); }
      catch (e) { return JSON.stringify({ error: e instanceof Error ? e.message : String(e) }); }
    },
  };
}

export const TOOLS: ToolSpec[] = [
  spec("search_products", "store", "Search a store's catalogue. Returns products with prices and product page URLs.",
    z.object({ store, query: z.string().describe("Search terms; empty returns everything").default("") }),
    (a, e) => ({ url: mcpUrls(e.gatewayUrl)[a.store], args: { query: a.query } })),
  spec("get_product", "store", "Full details for one product in a store's catalogue.",
    z.object({ store, sku: z.string() }),
    (a, e) => ({ url: mcpUrls(e.gatewayUrl)[a.store], args: { sku: a.sku } })),
  spec("get_mandate", "gateway", "Read what the user has authorised you to buy: budget remaining, allowed categories, merchant rules, approval threshold and expiry. Call this before shopping.",
    z.object({}),
    (_a, e) => ({ url: mcpUrls(e.gatewayUrl).gateway, args: {}, key: e.agentKey })),
  spec("request_purchase", "gateway", "Ask the gateway to buy one product for the user with their PayPal account. You never handle payment details. The gateway reads the product page itself, checks the purchase against the user's mandate, and then pays, asks the user, or blocks it with a reason.",
    z.object({
      product_url: z.string().describe("The product page URL on the merchant's site"),
      quantity: z.number().int().min(1).max(20).default(1),
      expected_price: z.number().positive().describe("The unit price you saw, in the product's currency, e.g. 89.00"),
      user_request: z.string().min(3).describe("What the user asked you for, in their own words"),
      reason: z.string().optional().describe("Why this product fits the request"),
    }),
    (a, e) => ({ url: mcpUrls(e.gatewayUrl).gateway, args: a, key: e.agentKey })),
  spec("check_status", "gateway", "Get the current status of a purchase you requested, e.g. after the user approves one.",
    z.object({ purchase_id: z.string() }),
    (a, e) => ({ url: mcpUrls(e.gatewayUrl).gateway, args: a, key: e.agentKey })),
  spec("report_problem", "gateway", "Tell the gateway something went wrong with a completed purchase (wrong item, not received, damaged). The gateway sends the merchant the signed record of what was ordered and pursues a refund.",
    z.object({ purchase_id: z.string(), description: z.string().min(5).describe("What the user says went wrong, in their own words") }),
    (a, e) => ({ url: mcpUrls(e.gatewayUrl).gateway, args: a, key: e.agentKey })),
];
export const toolsFor = (...groups: ToolGroup[]) => TOOLS.filter((t) => groups.includes(t.group));

/** Normalise an MCP-client tool name (e.g. "mcp__stride__search_products") to the trace's canonical form. */
export function canonicalToolCall(rawName: string, args: Record<string, unknown>): { tool: string; args: Record<string, unknown> } {
  const m = /^(?:mcp__)?(stride|kickz|gateway|mandate)(?:__|_|-)(.+)$/.exec(rawName);
  if (!m) return { tool: rawName, args };
  return STORES.includes(m[1] as (typeof STORES)[number]) ? { tool: m[2], args: { store: m[1], ...args } } : { tool: m[2], args };
}
