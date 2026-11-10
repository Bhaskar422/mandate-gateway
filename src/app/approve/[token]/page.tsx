import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import ApprovalCard from "@/components/public/ApprovalCard";
import PublicShell from "@/components/shell/PublicShell";
import { db, schema } from "@/lib/db";
import { purchaseByApprovalToken } from "@/lib/gateway";

export const metadata: Metadata = { title: "Approve a purchase", robots: { index: false } };
export const dynamic = "force-dynamic";
export const maxDuration = 60; // approving pays through PayPal

/** Reached from a link the agent hands the user. There is no session: the unguessable token is the credential. */
export default async function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const p = await purchaseByApprovalToken(token);
  const waiting = p && p.status === "pending_approval" && p.product ? p : null;

  const [[agent], [merchant]] = !waiting ? [[], []] : await Promise.all([
    db.select({ name: schema.agents.name }).from(schema.agents).where(eq(schema.agents.id, waiting.agentId)),
    waiting.merchantId ? db.select({ name: schema.merchants.name, verified: schema.merchants.verified }).from(schema.merchants).where(eq(schema.merchants.id, waiting.merchantId)) : Promise.resolve([]),
  ]);

  return (
    <PublicShell width="max-w-[520px]" nav={false}>
      <ApprovalCard request={waiting && {
        token, productName: waiting.product!.name, amountCents: waiting.amountCents, currency: waiting.currency, quantity: waiting.quantity,
        merchant: merchant?.name ?? null, merchantVerified: !!merchant?.verified, agent: agent?.name ?? null,
        userRequest: waiting.userRequest, agentReason: waiting.agentReason, reason: waiting.decision.reason, signals: waiting.product!.signals ?? [],
      }} />
    </PublicShell>
  );
}
