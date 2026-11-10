import { getStore } from "@/lib/stores/catalog";
import { recordOrder } from "@/lib/stores/merchant";
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getStore(slug)) return Response.json({ error: "No such store" }, { status: 404 });
  try { const o = await recordOrder(slug, (await req.json()).entry); return Response.json({ orderId: o.id }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
