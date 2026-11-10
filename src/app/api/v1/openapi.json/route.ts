import { appUrl } from "@/lib/config";

// The REST API mirrors the MCP tools one to one, for agents and frameworks without MCP support.
export const dynamic = "force-dynamic";
export function GET() {
  const purchase = { type: "object", required: ["product_url", "expected_price", "user_request"], properties: {
    product_url: { type: "string", description: "The product page URL on the merchant's site" },
    quantity: { type: "integer", minimum: 1, maximum: 20, default: 1 },
    expected_price: { type: "number", description: "The unit price the agent saw, e.g. 89.00" },
    user_request: { type: "string", description: "What the user asked for, in their own words" },
    reason: { type: "string", description: "Why this product fits the request" },
    idempotency_key: { type: "string", description: "Unique per purchase attempt; resend it when retrying" } } };
  const result = { type: "object", properties: { purchase_id: { type: "string" }, status: { type: "string", enum: ["captured", "blocked", "pending_approval", "payment_failed", "declined", "refund_requested", "refunded", "partially_refunded", "disputed"] },
    product: { type: "string", nullable: true }, amount: { type: "string", nullable: true }, message: { type: "string" }, record: { type: "string" }, approval_url: { type: "string" } } };
  const json = (schema: unknown) => ({ content: { "application/json": { schema } } });
  return Response.json({
    openapi: "3.0.3",
    info: { title: "Mandate Gateway API", version: "1.1.0", description: "Lets an AI agent pay through a user's PayPal account within the mandate the user set. The agent never handles payment credentials." },
    servers: [{ url: `${appUrl()}/api/v1` }],
    components: { securitySchemes: { agentKey: { type: "http", scheme: "bearer", description: "An agent key (mk_...) from the Mandate dashboard" } }, schemas: { PurchaseRequest: purchase, Purchase: result } },
    security: [{ agentKey: [] }],
    paths: {
      "/mandate": { get: { operationId: "getMandate", summary: "What the user has authorised this agent to buy", responses: { "200": { description: "The active mandates for this agent", ...json({ type: "object" }) } } } },
      "/purchases/check": { post: { operationId: "checkPurchase", summary: "Dry run: would this purchase be paid, need approval, or be blocked?", requestBody: { required: true, ...json({ $ref: "#/components/schemas/PurchaseRequest" }) }, responses: { "200": { description: "The decision. Nothing is charged or recorded.", ...json({ type: "object" }) } } } },
      "/purchases": { post: { operationId: "requestPurchase", summary: "Ask the gateway to buy one product", parameters: [{ name: "Idempotency-Key", in: "header", schema: { type: "string" } }],
        requestBody: { required: true, ...json({ $ref: "#/components/schemas/PurchaseRequest" }) }, responses: { "201": { description: "Paid, or waiting for the user's approval", ...json({ $ref: "#/components/schemas/Purchase" }) }, "200": { description: "Blocked by the mandate, with the reason", ...json({ $ref: "#/components/schemas/Purchase" }) } } } },
      "/purchases/{id}": { get: { operationId: "getPurchase", summary: "Current status of a purchase", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "The purchase", ...json({ $ref: "#/components/schemas/Purchase" }) } } } },
      "/purchases/{id}/problems": { post: { operationId: "reportProblem", summary: "Report a problem and start a refund or settlement", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, ...json({ type: "object", required: ["description"], properties: { description: { type: "string" } } }) }, responses: { "201": { description: "The case and its outcome so far", ...json({ type: "object" }) } } } },
    },
  });
}
