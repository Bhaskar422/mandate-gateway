import { getStore } from "@/lib/stores/catalog";
import { cancelHeldOrder } from "@/lib/stores/merchant";
export const maxDuration = 60;
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getStore(slug)) return Response.json({ voided: false, reason: "No such store" }, { status: 404 });
  try { return Response.json(await cancelHeldOrder(slug, await req.json())); }
  catch (e) { console.error(e); return Response.json({ voided: false, reason: `The store could not release the reservation: ${e instanceof Error ? e.message : e}` }); }
}
