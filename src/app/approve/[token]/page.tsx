import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import ApprovalCard from "@/components/public/ApprovalCard";
import Logo from "@/components/shell/Logo";
import ThemeToggle from "@/components/shell/ThemeToggle";
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

  const [[agent], [merchant], [user]] = !waiting ? [[], [], []] : await Promise.all([
    db.select({ name: schema.agents.name }).from(schema.agents).where(eq(schema.agents.id, waiting.agentId)),
    waiting.merchantId ? db.select({ name: schema.merchants.name, verified: schema.merchants.verified }).from(schema.merchants).where(eq(schema.merchants.id, waiting.merchantId)) : Promise.resolve([]),
    db.select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, waiting.userId)),
  ]);

  // A frame of its own: this page is opened on a phone, so the first screen goes to the decision and nothing else.
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-[520px] items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <Logo size={22} />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-[520px] flex-1 px-3 pb-28 pt-3 sm:px-6 sm:py-10">
        <ApprovalCard request={waiting && {
          token, productName: waiting.product!.name, amountCents: waiting.amountCents, currency: waiting.currency, quantity: waiting.quantity,
          merchant: merchant?.name ?? null, merchantVerified: !!merchant?.verified, agent: agent?.name ?? null,
          userRequest: waiting.userRequest, agentReason: waiting.agentReason, reason: waiting.decision.reason, signals: waiting.product!.signals ?? [],
          reserve: !!user?.settings?.chargeOnShipment,
        }} />
        <p className="mt-4 px-1 text-center text-xs text-ink-3">Mandate runs against the PayPal sandbox. No real money moves.</p>
      </main>
    </div>
  );
}
