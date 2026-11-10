import { eq } from "drizzle-orm";
import { appUrl, storePayee } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { getStore } from "@/lib/stores/catalog";

// What a merchant publishes on its own site to join the gateway: proof of domain control, its PayPal payee,
// and where the gateway should send paid orders and return requests.
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = getStore(slug);
  if (!s) return Response.json({ error: "No such store" }, { status: 404 });
  const [settings] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.slug, slug));
  const payee = storePayee(slug), base = `${appUrl()}/stores/${slug}`;
  return Response.json({
    mandate_verification: settings?.verificationToken ?? null, name: s.name,
    paypal: { ...(payee.merchantId ? { merchant_id: payee.merchantId } : {}), ...(payee.email ? { email: payee.email } : {}) },
    orders_url: `${base}/api/orders`, returns_url: `${base}/api/returns`,
  });
}
