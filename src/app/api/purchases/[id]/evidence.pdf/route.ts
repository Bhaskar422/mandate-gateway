import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { money } from "@/lib/ids";
import { evidenceBundle } from "@/lib/ledger";
import { textPdf } from "@/lib/pdf";
import { currentUserId } from "@/lib/session";

// The buyer's copy of the evidence record as a PDF, e.g. to attach to a PayPal dispute.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId().catch(() => null);
  const [p] = userId ? await db.select().from(schema.purchases).where(and(eq(schema.purchases.id, id), eq(schema.purchases.userId, userId))) : [];
  if (!p) return Response.json({ error: "Not found" }, { status: 404 });
  const b = await evidenceBundle(id);
  const lines = [
    `Purchase ${p.id}   Status ${p.status}   ${p.product?.name ?? p.productUrl}   ${p.amountCents ? money(p.amountCents, p.currency) : ""}`,
    `PayPal order ${p.paypalOrderId ?? "none"}   capture ${p.paypalCaptureId ?? "none"}`, "",
    ...b.entries.flatMap((e) => [`#${e.seq}  ${e.type}  ${e.at}`, ...JSON.stringify(e.payload, null, 1).split("\n").slice(0, 60).map((l) => `  ${l}`), `  hash ${e.hash}`, `  sig  ${e.signature}`, ""]),
    "Verify: each hash is sha256(previous hash + entry); each signature is Ed25519 over the hash, by the key below.", ...b.publicKey.trim().split("\n"),
  ];
  return new Response(new Uint8Array(textPdf(`Mandate evidence record ${p.id}`, lines)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="evidence-${p.id}.pdf"` } });
}
