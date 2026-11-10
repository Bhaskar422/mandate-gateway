import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { applyWebhook } from "@/lib/gateway";
import { verifyWebhook } from "@/lib/paypal";
import { STORES } from "@/lib/stores/catalog";
import { handleDispute } from "@/lib/stores/merchant";
import { storeCreds } from "@/lib/config";
import type { Dispute } from "@/lib/paypal";

// One endpoint for the gateway's PayPal app and the demo stores' apps. Each app has its own webhook id.
export const maxDuration = 60;
export async function POST(req: Request) {
  const raw = await req.text();
  let event: { id: string; event_type: string; resource: Record<string, unknown> };
  try { event = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  let verified = await verifyWebhook(req.headers, raw, process.env.PAYPAL_WEBHOOK_ID);
  let store: string | null = null;
  for (const s of STORES) {
    if (verified) break;
    const c = storeCreds(s.slug), id = process.env[`PAYPAL_STORE_${s.slug.toUpperCase()}_WEBHOOK_ID`];
    if (c && id && await verifyWebhook(req.headers, raw, id, c)) { verified = true; store = s.slug; }
  }
  if (!verified) return new Response("signature verification failed", { status: 400 });
  const fresh = await db.insert(schema.webhookEvents).values({ id: event.id, eventType: event.event_type, resource: event.resource, verified }).onConflictDoNothing().returning();
  if (fresh.length) {
    await applyWebhook(event.event_type, event.resource);
    if (event.event_type.startsWith("CUSTOMER.DISPUTE.")) {
      // The event can arrive through either app's webhook, so find the store from the disputed order itself.
      const d = event.resource as unknown as Dispute;
      const captureId = d.disputed_transactions?.[0]?.seller_transaction_id;
      const [order] = captureId ? await db.select({ slug: schema.storeOrders.storeSlug }).from(schema.storeOrders).where(eq(schema.storeOrders.paypalCaptureId, captureId)) : [];
      const slug = order?.slug ?? store;
      if (slug) await handleDispute(slug, d).then((r) => console.log("dispute handled:", JSON.stringify(r))).catch((e) => console.error("dispute handling failed:", e));
    }
  }
  return Response.json({ ok: true });
}
