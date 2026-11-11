import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, ne, or } from "drizzle-orm";
import { appUrl, paypalSimulated } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { append } from "@/lib/ledger";
import { createPaymentToken } from "@/lib/paypal";
import { currentUserId, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

const { paypalLinks } = schema;

export async function GET() {
  const userId = await currentUserId();
  let q = "linked";
  try {
    const [link] = await db.select().from(paypalLinks).where(eq(paypalLinks.userId, userId));
    if (!link?.setupTokenId) throw new Error("No PayPal link in progress");
    // Use the setup token we stored for this user, not one from the URL.
    const t = await createPaymentToken(link.setupTokenId);
    const wallet = { vaultId: t.vaultId, customerId: t.customerId, payerId: t.payerId, payerEmail: t.payerEmail, status: "active" as const, setupTokenId: null };

    // The PayPal account is the identity. If it already has a Mandate account, this browser is signed in to that
    // account instead of starting a second one. (Simulated PayPal gives everyone the same buyer, so it is skipped.)
    const same = [t.payerId ? eq(paypalLinks.payerId, t.payerId) : null, t.payerEmail ? eq(paypalLinks.payerEmail, t.payerEmail) : null].filter((x) => x !== null);
    const [owner] = paypalSimulated() || !same.length ? [] :
      await db.select().from(paypalLinks).where(and(ne(paypalLinks.userId, userId), eq(paypalLinks.status, "active"), or(...same))).limit(1);

    if (owner) {
      const [[mine], [agent]] = await Promise.all([
        db.select({ id: schema.mandates.id }).from(schema.mandates).where(eq(schema.mandates.userId, userId)).limit(1),
        db.select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.userId, userId)).limit(1),
      ]);
      // Two accounts with their own mandates or agents are never merged silently.
      if (mine || agent) throw new Error("That PayPal account already belongs to another Mandate account. Sign out in Settings, then link it to return to that account.");
      await db.update(paypalLinks).set(wallet).where(eq(paypalLinks.userId, owner.userId));
      await db.delete(paypalLinks).where(eq(paypalLinks.userId, userId));
      await append({ userId: owner.userId, type: "paypal.signed_in", payload: { payerEmail: t.payerEmail } });
      (await cookies()).set(SESSION_COOKIE, owner.userId, sessionCookieOptions(appUrl().startsWith("https:")));
      q = "restored";
    } else {
      await db.update(paypalLinks).set(wallet).where(eq(paypalLinks.userId, userId));
      await append({ userId, type: "paypal.linked", payload: { payerEmail: t.payerEmail, customerId: t.customerId } });
    }
  } catch (e) { console.error(e); q = `error&detail=${encodeURIComponent(e instanceof Error ? e.message : "error")}`; }
  redirect(`${appUrl()}/?paypal=${q}`);
}
