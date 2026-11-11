import { redirect } from "next/navigation";
import { appUrl } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { createSetupToken } from "@/lib/paypal";
import { currentUserId } from "@/lib/session";

export async function GET() {
  const userId = await currentUserId();
  let target: string;
  try {
    const t = await createSetupToken(`${appUrl()}/api/paypal/return`, `${appUrl()}/?paypal=cancelled`);
    await db.insert(schema.paypalLinks).values({ userId, setupTokenId: t.id, status: "pending" })
      // A wallet already linked stays in use until the new one is approved.
      .onConflictDoUpdate({ target: schema.paypalLinks.userId, set: { setupTokenId: t.id } });
    target = t.approveUrl;
  } catch (e) { console.error(e); target = `${appUrl()}/?paypal=error&detail=${encodeURIComponent(e instanceof Error ? e.message : "error")}`; }
  redirect(target);
}
