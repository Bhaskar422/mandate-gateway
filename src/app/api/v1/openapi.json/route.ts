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
  const result = { type: "object", properties: { purchase_id: { type: "string" }, status: { type: "string", enum: ["captured", "authorized", "cancelled", "blocked", "pending_approval", "payment_failed", "declined", "refund_requested", "refunded", "partially_refunded", "disputed"] },
    product: { type: "string", nullable: true }, amount: { type: "string", nullable: true }, message: { type: "string" }, record: { type: "string" }, approval_url: { type: "string" } } };
  const cents = (description: string, nullable = false) => ({ type: "integer", nullable, description });
  const credential = { type: "object", required: ["payload", "signature"], description: "A mandate credential. Verify it offline: Ed25519 over the canonical JSON of payload (object keys sorted, no whitespace), against the public key at /.well-known/mandate-gateway.json. It holds no payment details and authorises nothing by itself.",
    properties: { signature: { type: "string", description: "Base64 Ed25519 signature" }, algorithm: { type: "string", enum: ["ed25519 over canonical JSON"] },
      payload: { type: "object", required: ["type", "version", "id", "issuer", "agent", "audience", "issuedAt", "expiresAt", "mandates", "neverBuy"], properties: {
        type: { type: "string", enum: ["mandate.authorisation"] }, version: { type: "integer", enum: [1] }, id: { type: "string", description: "Unique to this credential, cred_..." },
        issuer: { type: "string", description: "The gateway's address" }, agent: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        audience: { type: "string", nullable: true, description: "The base address of the one store this credential is for, or null when it is not bound to a store" },
        issuedAt: { type: "string", format: "date-time" }, expiresAt: { type: "string", format: "date-time", description: "15 minutes after issuedAt" },
        mandates: { type: "array", items: { type: "object", required: ["id", "rulesHash", "currency", "remainingCents", "perPurchaseLimitCents", "approvalThresholdCents", "allowedCategories", "merchantPolicy", "allowedMerchants", "expiresAt"], properties: {
          id: { type: "string" }, rulesHash: { type: "string", description: "SHA-256 of the mandate's rules" }, currency: { type: "string", description: "ISO 4217" },
          remainingCents: cents("Budget left when the credential was issued"), perPurchaseLimitCents: cents("Most for one purchase; null when there is none", true),
          approvalThresholdCents: cents("Purchases above this need the buyer's approval; null when there is none", true),
          allowedCategories: { type: "array", items: { type: "string" } }, merchantPolicy: { type: "string", enum: ["verified_only", "allowlist", "any_registered"] },
          allowedMerchants: { type: "array", items: { type: "string" }, description: "Store names or domains, when merchantPolicy is allowlist; otherwise empty" }, expiresAt: { type: "string", format: "date-time" } } } },
        neverBuy: { type: "array", items: { type: "string" }, description: "Stores the buyer said never to buy from" }, note: { type: "string" } } } } };
  const json = (schema: unknown) => ({ content: { "application/json": { schema } } });
  return Response.json({
    openapi: "3.0.3",
    info: { title: "Mandate Gateway API", version: "1.1.0", description: "Lets an AI agent pay through a user's PayPal account within the mandate the user set. The agent never handles payment credentials." },
    servers: [{ url: `${appUrl()}/api/v1` }],
    components: { securitySchemes: { agentKey: { type: "http", scheme: "bearer", description: "An agent key (mk_...) from the Mandate dashboard" } }, schemas: { PurchaseRequest: purchase, Purchase: result, MandateCredential: credential } },
    security: [{ agentKey: [] }],
    paths: {
      "/mandate": { get: { operationId: "getMandate", summary: "What the user has authorised this agent to buy", responses: { "200": { description: "The active mandates for this agent", ...json({ type: "object" }) } } } },
      "/purchases/check": { post: { operationId: "checkPurchase", summary: "Dry run: would this purchase be paid, need approval, or be blocked?", requestBody: { required: true, ...json({ $ref: "#/components/schemas/PurchaseRequest" }) }, responses: { "200": { description: "The decision. Nothing is charged or recorded.", ...json({ type: "object" }) } } } },
      "/purchases": { post: { operationId: "requestPurchase", summary: "Ask the gateway to buy one product", parameters: [{ name: "Idempotency-Key", in: "header", schema: { type: "string" } }],
        requestBody: { required: true, ...json({ $ref: "#/components/schemas/PurchaseRequest" }) }, responses: { "201": { description: "Paid, or waiting for the user's approval", ...json({ $ref: "#/components/schemas/Purchase" }) }, "200": { description: "Blocked by the mandate, with the reason", ...json({ $ref: "#/components/schemas/Purchase" }) } } } },
      "/purchases/{id}": { get: { operationId: "getPurchase", summary: "Current status of a purchase", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "The purchase", ...json({ $ref: "#/components/schemas/Purchase" }) } } } },
      "/purchases/{id}/problems": { post: { operationId: "reportProblem", summary: "Report a problem and start a refund or settlement", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, ...json({ type: "object", required: ["description"], properties: { description: { type: "string" } } }) }, responses: { "201": { description: "The case and its outcome so far", ...json({ type: "object" }) } } } },
      "/mandate/credential": { get: { operationId: "getCredential", summary: "A short-lived signed statement of what the mandate allows, for the agent to show a store. Same as the get_credential tool.",
        parameters: [{ name: "store_url", in: "query", required: false, schema: { type: "string" }, description: "The store's base address. The credential then works at that store only; stores reject one that is not bound to them." }],
        responses: { "200": { description: "The credential", ...json({ $ref: "#/components/schemas/MandateCredential" }) }, "400": { description: "store_url is not a web address" }, "404": { description: "No active mandate for this agent" } } } },
      "/credentials/verify": { post: { operationId: "verifyCredential", summary: "Check a credential with the gateway. A store does not need this call: it can run the same check offline.", security: [],
        requestBody: { required: true, ...json({ allOf: [{ $ref: "#/components/schemas/MandateCredential" }], properties: { audience: { type: "string", description: "Optional: also check the credential is for this store" } } }) },
        responses: { "200": { description: "Whether it is valid, and why not", ...json({ type: "object", properties: { valid: { type: "boolean" }, code: { type: "string" }, reason: { type: "string" }, payload: { type: "object" } } }) } } } },
      "/stores/{slug}/api/mandate": { servers: [{ url: appUrl() }], post: { operationId: "presentMandate", summary: "A demo store's own endpoint, not the gateway's: show the store a credential bound to it. The store verifies it offline and answers with its reading. Same as the store's present_mandate tool.", security: [],
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }], requestBody: { required: true, ...json({ $ref: "#/components/schemas/MandateCredential" }) },
        responses: { "200": { description: "Accepted: whether the store is covered, and which products are inside the limits, need approval or are outside. The gateway still decides every purchase.", ...json({ type: "object" }) },
          "400": { description: "Not a credential" }, "401": { description: "Rejected: bad signature, expired, not bound to a store, or bound to another store", ...json({ type: "object", properties: { accepted: { type: "boolean" }, code: { type: "string" }, reason: { type: "string" } } }) } } } },
    },
  });
}
