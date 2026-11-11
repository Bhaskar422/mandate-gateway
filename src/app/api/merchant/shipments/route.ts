import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { captureOnShipment } from "@/lib/gateway";
import { storeSignatureProblem } from "@/lib/store-auth";

export const maxDuration = 60;
/**
 * A store reports that a reserved order has shipped. The gateway charges the buyer and returns the signed capture
 * record. The store names the purchase and the authorization id the gateway sent it with the order. A store that
 * has published a signing key must also sign the request (see src/lib/stores/sign-request.ts); knowing the ids is
 * then not enough.
 */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const b = JSON.parse(raw) as { purchaseId?: string; authorizationId?: string; tracking?: string };
    if (typeof b.purchaseId !== "string" || typeof b.authorizationId !== "string") return Response.json({ error: "purchaseId and authorizationId are required" }, { status: 400 });
    const [p] = await db.select({ merchantId: schema.purchases.merchantId }).from(schema.purchases).where(eq(schema.purchases.id, b.purchaseId));
    const [m] = p?.merchantId ? await db.select().from(schema.merchants).where(eq(schema.merchants.id, p.merchantId)) : [];
    const refused = await storeSignatureProblem(req, raw, m);
    if (refused) return refused;
    return Response.json(await captureOnShipment({ purchaseId: b.purchaseId, authorizationId: b.authorizationId, tracking: typeof b.tracking === "string" ? b.tracking.slice(0, 64) : null }));
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Could not charge the reservation" }, { status: 400 }); }
}
