import { getStore } from "@/lib/stores/catalog";
import { acceptOffer } from "@/lib/stores/merchant";
export const maxDuration = 60;
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getStore(slug)) return Response.json({ error: "No such store" }, { status: 404 });
  try { return Response.json(await acceptOffer(slug, await req.json())); }
  catch (e) { console.error(e); return Response.json({ decision: "declined", reason: `The settlement failed at the merchant: ${e instanceof Error ? e.message : e}` }); }
}
