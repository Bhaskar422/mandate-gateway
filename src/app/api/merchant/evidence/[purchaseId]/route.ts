import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { append, evidenceBundle } from "@/lib/ledger";
import { storeSignatureProblem } from "@/lib/store-auth";

// A merchant facing a dispute asks the gateway for the signed record of the purchase.
// It names the PayPal capture id, which only the buyer, the gateway and the payee hold. A store that has published
// a signing key must also sign the request, so the capture id alone does not release the record.
export async function GET(req: Request, { params }: { params: Promise<{ purchaseId: string }> }) {
  const { purchaseId } = await params;
  const capture = new URL(req.url).searchParams.get("capture");
  const [p] = capture ? await db.select().from(schema.purchases).where(and(eq(schema.purchases.id, purchaseId), eq(schema.purchases.paypalCaptureId, capture))) : [];
  if (!p) return Response.json({ error: "Not found" }, { status: 404 });
  const [m] = p.merchantId ? await db.select().from(schema.merchants).where(eq(schema.merchants.id, p.merchantId)) : [];
  const refused = await storeSignatureProblem(req, "", m);
  if (refused) return refused;
  const disputeId = new URL(req.url).searchParams.get("dispute");
  await append({ userId: p.userId, purchaseId, type: "dispute.evidence_submitted", payload: { releasedTo: "merchant", disputeId, reason: "merchant requested the signed record to answer a PayPal dispute" } });
  return Response.json(await evidenceBundle(purchaseId));
}
