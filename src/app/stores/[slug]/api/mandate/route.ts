import { getStore } from "@/lib/stores/catalog";
import { presentToStore } from "@/lib/stores/present";

// For agents without MCP: post the credential the gateway issued for this store, { payload, signature }.
// The store verifies it offline and answers with its own reading. Same as the present_mandate tool.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const s = getStore((await params).slug);
  if (!s) return Response.json({ error: "No such store" }, { status: 404 });
  let sent: unknown = null;
  try { sent = await req.json(); } catch { /* answered as malformed below */ }
  const r = presentToStore(s, (sent as { credential?: unknown } | null)?.credential ?? sent);
  return Response.json(r.body, { status: r.status });
}
