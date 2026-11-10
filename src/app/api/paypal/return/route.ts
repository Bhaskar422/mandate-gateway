import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { appUrl } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { append } from "@/lib/ledger";
import { createPaymentToken } from "@/lib/paypal";
import { currentUserId } from "@/lib/session";

export async function GET() {
  const userId = await currentUserId();
  let q = "linked";
  try {
    const [link] = await db.select().from(schema.paypalLinks).where(eq(schema.paypalLinks.userId, userId));
    if (!link?.setupTokenId) throw new Error("No PayPal link in progress");
    // Use the setup token we stored for this user, not one from the URL.
    const t = await createPaymentToken(link.setupTokenId);
    await db.update(schema.paypalLinks).set({ vaultId: t.vaultId, customerId: t.customerId, payerEmail: t.payerEmail, status: "active" }).where(eq(schema.paypalLinks.userId, userId));
    await append({ userId, type: "paypal.linked", payload: { payerEmail: t.payerEmail, customerId: t.customerId } });
  } catch (e) { console.error(e); q = `error&detail=${encodeURIComponent(e instanceof Error ? e.message : "error")}`; }
  redirect(`${appUrl()}/?paypal=${q}`);
}
