import { getStore } from "@/lib/stores/catalog";
import { orderStatement } from "@/lib/stores/merchant";

/** The store's own account of one order, for comparing with the gateway's record when a buyer has a complaint. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getStore(slug)) return Response.json({ error: "No such store" }, { status: 404 });
  const s = await orderStatement(slug, await req.json().catch(() => ({})));
  return s ? Response.json(s) : Response.json({ error: "No order matches" }, { status: 404 });
}
