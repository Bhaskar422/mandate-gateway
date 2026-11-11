// The mandate credential: a short-lived statement, signed by the gateway, of what an agent may buy for a user.
// The agent carries it to a store; the store checks it offline with src/lib/stores/verify-mandate.ts and the
// gateway's published key. It names no payment details, no buyer and none of the mandate's own wording, and it
// authorises nothing by itself: every purchase still goes through the policy engine.
import { appUrl } from "./config";
import { db } from "./db";
import { activeMandates, committedSpend, type AgentRef } from "./gateway";
import { newId } from "./ids";
import { listMerchants } from "./merchants";
import { publicKeyPem, signPayload } from "./ledger";
import type { MandateRules } from "./rules";
import { CREDENTIAL_TYPE, CREDENTIAL_VERSION, normalizeAudience, verifyCredential, type CredentialPayload } from "./stores/verify-mandate";

export const CREDENTIAL_TTL_MS = 15 * 60_000;
export const CREDENTIAL_NOTE = "Payment is made by the gateway, not the agent. This credential authorises nothing by itself.";

export type CredentialSource = { id: string; rulesHash: string; rules: MandateRules; committedCents: number };

/** Build the statement that gets signed. Pure: everything it says is passed in, and only the fields listed here leave the gateway. */
export function credentialPayload(a: { issuer: string; agentId: string; audience: string | null; mandates: CredentialSource[]; neverBuy: string[]; now?: number; id?: string; store?: { registered: boolean; verified: boolean } }): CredentialPayload {
  const now = a.now ?? Date.now();
  return {
    type: CREDENTIAL_TYPE, version: CREDENTIAL_VERSION, id: a.id ?? newId("cred"), issuer: a.issuer, agent: { id: a.agentId }, audience: a.audience,
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + CREDENTIAL_TTL_MS).toISOString(),
    mandates: a.mandates.map(({ id, rulesHash, rules: r, committedCents }) => ({
      id, rulesHash, currency: r.currency, remainingCents: Math.max(r.totalLimitCents - committedCents, 0),
      perPurchaseLimitCents: r.perPurchaseLimitCents ?? null, approvalThresholdCents: r.approvalThresholdCents ?? null,
      allowedCategories: r.allowedCategories, merchantPolicy: r.merchantPolicy,
      allowedMerchants: r.merchantPolicy === "allowlist" ? r.allowedMerchants ?? [] : [], expiresAt: r.expiresAt,
    })),
    neverBuy: [...new Set(a.neverBuy)], note: CREDENTIAL_NOTE,
    ...(a.audience && a.store ? { store: { registered: a.store.registered, verified: a.store.verified } } : {}),
  };
}

export type IssueError = { error: { code: "no_mandate" | "invalid_request"; message: string } };

/** Issue a credential for this agent, bound to one store when `storeUrl` is given. Shared by the MCP tool and the REST endpoint. */
export async function issueCredential(agent: AgentRef, storeUrl?: string | null) {
  const audience = storeUrl ? normalizeAudience(storeUrl) : null;
  if (storeUrl && !audience) return { error: { code: "invalid_request", message: "store_url must be the store's web address, e.g. https://shop.example" } } satisfies IssueError;
  const now = Date.now();
  const list = (await activeMandates(agent.userId, agent.id)).filter((m) => new Date(m.rules.expiresAt).getTime() > now);
  if (!list.length) return { error: { code: "no_mandate", message: "The user has no active mandate for this agent." } } satisfies IssueError;
  // "Never buy from X" in any of the user's mandates holds for all of them, so the list is taken from every one.
  const neverBuy = (await activeMandates(agent.userId)).flatMap((m) => m.rules.blockedMerchants ?? []);
  const mandates = await Promise.all(list.map(async (m) => ({ id: m.id, rulesHash: m.rulesHash, rules: m.rules, committedCents: (await committedSpend(db, m.id)).committedCents })));
  return signPayload(credentialPayload({ issuer: appUrl(), agentId: agent.id, audience, mandates, neverBuy, now, store: audience ? await storeStanding(audience) : undefined }));
}

/** Where a store stands with the gateway: registered means it can be paid at all, verified is the operator's review. */
async function storeStanding(audience: string) {
  const m = (await listMerchants()).find((x) => normalizeAudience(x.baseUrl) === audience);
  return { registered: !!m?.payable, verified: !!m?.payable && m.trust === "verified" };
}

/** The gateway's own check of a credential, for the public verify endpoint. A store does the same offline, and also checks the audience. */
export function checkCredential(credential: unknown, audience: string | null = null) {
  return verifyCredential(credential, { publicKeyPem: publicKeyPem(), audience });
}
