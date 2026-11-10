import { desc, eq } from "drizzle-orm";
import { ExternalLink, Handshake, Inbox, Scale } from "lucide-react";
import { money, type Tone } from "@/components/format";
import LocalTime from "@/components/LocalTime";
import { DisputeSync, OrderActions, PublishToken } from "@/components/stores/BackOfficeActions";
import { storeTheme } from "@/components/stores/storeThemes";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, Fact } from "@/components/ui/Layout";
import { appUrl, storeCreds } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { listMerchants } from "@/lib/merchants";
import { getStore } from "@/lib/stores/catalog";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // checking disputes talks to PayPal and a model

const ORDER: Record<string, { label: string; tone: Tone }> = { paid: { label: "Paid, to ship", tone: "warn" }, shipped: { label: "Shipped", tone: "ok" }, refunded: { label: "Refunded", tone: "info" } };
const REGISTRY: Record<string, { label: string; tone: Tone; note: string }> = {
  verified: { label: "Verified", tone: "ok", note: "The gateway's operator has checked this store. Any mandate that allows verified stores can buy here." },
  registered: { label: "Registered", tone: "info", note: "The gateway knows this store and who to pay, but has not verified it. Only mandates that name it, or accept any registered store, can buy here." },
  pending: { label: "Pending", tone: "warn", note: "The gateway issued a token for this store. Publish it below, then press “Check the file now” on Mandate's Merchants page." },
  none: { label: "Not in the registry", tone: "neutral", note: "The gateway does not know this store, so agents cannot buy here yet. Enter this store's address on Mandate's Merchants page to get a token." },
};

/** The shop owner's side of the demo: orders that arrived from the gateway, what was shipped, refunds, offers and disputes. */
export default async function StoreAdmin({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = getStore(slug)!;
  const t = storeTheme(slug);
  const base = `${appUrl()}/stores/${slug}`;
  const [orders, [settings], merchants] = await Promise.all([
    db.select().from(schema.storeOrders).where(eq(schema.storeOrders.storeSlug, slug)).orderBy(desc(schema.storeOrders.createdAt)),
    db.select().from(schema.storeSettings).where(eq(schema.storeSettings.slug, slug)),
    listMerchants(),
  ]);
  const name = (sku: string | null) => s.products.find((p) => p.sku === sku)?.name ?? sku ?? "";
  const reg = REGISTRY[merchants.find((m) => m.baseUrl === base)?.trust ?? "none"];
  const open = orders.filter((o) => o.status === "paid").length;

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Back office</p>
          <h1 className={`mt-1 text-3xl text-ink ${t.heading}`}>Orders</h1>
          <p className="mt-1 text-base text-ink-2">{orders.length === 0 ? "Paid orders from the Mandate gateway arrive here." : `${orders.length} ${orders.length === 1 ? "order" : "orders"}, ${open} waiting to ship.`}</p>
        </div>
        <DisputeSync slug={slug} enabled={!!storeCreds(slug)} />
      </header>

      <section aria-label="Orders">
        {orders.length === 0 ? (
          <EmptyState icon={<Inbox size={18} aria-hidden />} title="No orders yet">When an agent buys from this shop through the gateway, the paid order appears here with the gateway&apos;s signed payment record.</EmptyState>
        ) : (
          <ul className="space-y-4">
            {orders.map((o) => {
              const wrong = s.products.find((p) => p.sku !== o.sku && !p.sku.includes("GIFT")) ?? null;
              const mis = !!o.shippedSku && o.shippedSku !== o.sku;
              const st = ORDER[o.status] ?? { label: o.status, tone: "neutral" as Tone };
              return (
                <li key={o.id} className={`border border-line bg-surface p-4 sm:p-5 ${t.radius}`}>
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">{name(o.sku)}</h2>
                      <p className="text-sm text-ink-3"><span className="code">{o.id}</span> · <LocalTime iso={o.createdAt.toISOString()} /></p>
                    </div>
                    <p className="num text-lg font-semibold text-ink">{money(o.amountCents)}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {mis && <Badge tone="bad">Wrong item shipped</Badge>}
                    {o.offer && <Badge tone="warn" icon={<Handshake size={12} aria-hidden />}>Offer open</Badge>}
                    {o.disputeStatus && <Badge tone="dispute" icon={<Scale size={12} aria-hidden />}>Dispute: {o.disputeStatus}</Badge>}
                  </div>

                  <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Fact label="Ordered"><span className="code">{o.sku}</span></Fact>
                    <Fact label="Shipped">{o.shippedSku ? <span className={mis ? "font-semibold text-bad-ink" : ""}>{name(o.shippedSku)} <span className="code">{o.shippedSku}</span></span> : <span className="text-ink-3">Not yet</span>}</Fact>
                    <Fact label="Tracking">{o.tracking ? <span className="code">{o.tracking}</span> : <span className="text-ink-3">None</span>}</Fact>
                    <Fact label="PayPal transaction">{o.paypalCaptureId ? <span className="code">{o.paypalCaptureId}</span> : <span className="text-ink-3">None</span>}</Fact>
                    {o.replacementSku && <Fact label="Replacement sent">{name(o.replacementSku)}</Fact>}
                    {o.paypalRefundId && <Fact label="PayPal refund"><span className="code">{o.paypalRefundId}</span></Fact>}
                    {o.disputeId && <Fact label="PayPal dispute"><span className="code">{o.disputeId}</span></Fact>}
                    <Fact label="Gateway purchase"><span className="code">{o.gatewayPurchaseId}</span></Fact>
                  </dl>

                  {o.offer && (
                    <div className="tone-warn mt-4 rounded-lg bg-warn-soft p-3 text-sm text-warn-ink">
                      <p className="font-semibold">Offer made to the buyer, waiting for an answer: {o.offer.type === "full_refund" ? "full refund" : o.offer.type === "replacement" ? `replacement${o.offer.sku ? ` (${o.offer.sku})` : ""}` : `partial refund of ${money(o.offer.amountCents ?? 0)}`}</p>
                      <p className="[overflow-wrap:anywhere]">{o.offer.reason}</p>
                    </div>
                  )}
                  {o.note && <p className="mt-3 text-sm text-ink-2 [overflow-wrap:anywhere]"><span className="font-semibold text-ink">Returns agent&apos;s note:</span> {o.note}</p>}

                  <OrderActions slug={slug} orderId={o.id} sku={o.sku} wrongSku={wrong?.sku ?? null} wrongName={wrong?.name ?? null} canShip={o.status === "paid"} canRule={o.disputeStatus === "evidence submitted"} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Gateway verification" className={`border border-line bg-raised p-5 sm:p-6 ${t.radius}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={`text-xl text-ink ${t.heading}`}>Gateway verification</h2>
          <Badge tone={reg.tone}>{reg.label}</Badge>
        </div>
        <p className="mt-1 max-w-2xl text-base text-ink-2">{reg.note}</p>
        <div className="mt-4 max-w-2xl"><PublishToken slug={slug} current={settings?.verificationToken ?? null} /></div>
        <dl className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <Fact label="Token published now">{settings?.verificationToken ? <span className="code break-all">{settings.verificationToken}</span> : <span className="text-ink-3">None</span>}</Fact>
          <Fact label="The file the gateway reads"><a href={`/stores/${slug}/.well-known/mandate-merchant.json`} target="_blank" rel="noreferrer" className="link code inline-flex items-start gap-1 break-all">{base}/.well-known/mandate-merchant.json<ExternalLink size={11} className="mt-1 shrink-0" aria-hidden /></a></Fact>
        </dl>
      </section>
    </div>
  );
}
