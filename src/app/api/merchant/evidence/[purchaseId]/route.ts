import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { append, evidenceBundle } from "@/lib/ledger";

// A merchant facing a dispute asks the gateway for the signed record of the purchase.
// It proves it is the payee by presenting the PayPal capture id, which only the buyer, the gateway and the payee hold.
export async function GET(req: Request, { params }: { params: Promise<{ purchaseId: string }> }) {
  const { purchaseId } = await params;
  const capture = new URL(req.url).searchParams.get("capture");
  const [p] = capture ? await db.select().from(schema.purchases).where(and(eq(schema.purchases.id, purchaseId), eq(schema.purchases.paypalCaptureId, capture))) : [];
  if (!p) return Response.json({ error: "Not found" }, { status: 404 });
  const disputeId = new URL(req.url).searchParams.get("dispute");
  await append({ userId: p.userId, purchaseId, type: "dispute.evidence_submitted", payload: { releasedTo: "merchant", disputeId, reason: "merchant requested the signed record to answer a PayPal dispute" } });
  return Response.json(await evidenceBundle(purchaseId));
}
