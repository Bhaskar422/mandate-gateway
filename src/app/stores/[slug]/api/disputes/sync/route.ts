import { getStore } from "@/lib/stores/catalog";
import { syncDisputes } from "@/lib/stores/merchant";
export async function POST(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getStore(slug)) return Response.json({ error: "No such store" }, { status: 404 });
  try { return Response.json(await syncDisputes(slug)); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
}
