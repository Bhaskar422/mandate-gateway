import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import PurchaseDetail, { type Verification } from "@/components/purchases/PurchaseDetail";
import { db, schema } from "@/lib/db";
import { evidenceBundle, verifyBundle, verifyChain } from "@/lib/ledger";
import { currentUserId } from "@/lib/session";

export const metadata: Metadata = { title: "Purchase record" };
export const maxDuration = 60; // approving, reporting a problem and answering an offer call the model and PayPal

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  const [p] = await db.select().from(schema.purchases).where(and(eq(schema.purchases.id, id), eq(schema.purchases.userId, userId)));
  if (!p) notFound();

  const bundle = await evidenceBundle(id);
  const own = verifyBundle(bundle, bundle.publicKey), chain = await verifyChain();
  const verification: Verification = !own.ok ? { ok: false, why: `This purchase's record does not verify: ${own.why}.` }
    : !chain.ok ? { ok: false, why: `The ledger chain is broken at entry ${chain.brokenAt}: ${chain.why}.` } : { ok: true };

  return (
    <PurchaseDetail verification={verification}
      basics={{ id: p.id, productName: p.product?.name ?? null, productUrl: p.productUrl, amountCents: p.amountCents, currency: p.currency, status: p.status, createdAt: p.createdAt.toISOString() }}
      entries={bundle.entries.map((e) => ({ seq: e.seq, type: e.type, at: e.at, payload: e.payload, prevHash: e.prevHash, hash: e.hash, signature: e.signature }))} />
  );
}
