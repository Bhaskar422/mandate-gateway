import { appUrl } from "@/lib/config";
import { activeMandates } from "@/lib/gateway";
import { signPayload } from "@/lib/ledger";
import { restAgent } from "@/lib/rest";

// A short-lived, signed statement that this agent is authorised to buy for a user, and within what bounds.
// An agent can hand it to a merchant before checkout; the merchant verifies it at /api/v1/credentials/verify
// or offline against the gateway's public key. It names no payment details and no personal data.
export async function GET(req: Request) {
  const agent = await restAgent(req);
  if (agent instanceof Response) return agent;
  const list = await activeMandates(agent.userId, agent.id);
  if (!list.length) return Response.json({ error: { code: "no_mandate", message: "The user has no active mandate for this agent." } }, { status: 404 });
  const now = Date.now();
  return Response.json(signPayload({
    type: "mandate.authorisation", issuer: appUrl(), agent: { id: agent.id, name: agent.name },
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 15 * 60_000).toISOString(),
    mandates: list.map((m) => ({ id: m.id, rulesHash: m.rulesHash, currency: m.rules.currency, allowedCategories: m.rules.allowedCategories, merchantPolicy: m.rules.merchantPolicy,
      perPurchaseLimitCents: m.rules.perPurchaseLimitCents, approvalThresholdCents: m.rules.approvalThresholdCents, expiresAt: m.rules.expiresAt })),
    note: "Payment is made by the gateway, not the agent. This credential authorises nothing by itself.",
  }));
}
