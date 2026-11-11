import { captureOnShipment } from "@/lib/gateway";

export const maxDuration = 60;
/**
 * A store reports that a reserved order has shipped. The gateway charges the buyer and returns the signed capture
 * record. The store identifies itself by the authorization id the gateway sent it with the order.
 */
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { purchaseId?: string; authorizationId?: string; tracking?: string };
    if (typeof b.purchaseId !== "string" || typeof b.authorizationId !== "string") return Response.json({ error: "purchaseId and authorizationId are required" }, { status: 400 });
    return Response.json(await captureOnShipment({ purchaseId: b.purchaseId, authorizationId: b.authorizationId, tracking: typeof b.tracking === "string" ? b.tracking.slice(0, 64) : null }));
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Could not charge the reservation" }, { status: 400 }); }
}
