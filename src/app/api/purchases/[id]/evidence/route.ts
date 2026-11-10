import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { evidenceBundle } from "@/lib/ledger";
import { currentUserId } from "@/lib/session";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId().catch(() => null);
  const [p] = userId ? await db.select({ id: schema.purchases.id }).from(schema.purchases).where(and(eq(schema.purchases.id, id), eq(schema.purchases.userId, userId))) : [];
  if (!p) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(await evidenceBundle(id), { headers: { "Content-Disposition": `attachment; filename="evidence-${id}.json"` } });
}
