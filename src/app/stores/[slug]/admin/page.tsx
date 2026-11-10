import { desc, eq } from "drizzle-orm";
import { sandboxRulingAction, shipOrderAction, syncDisputesAction } from "@/app/actions";
import { storeCreds } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { money } from "@/lib/ids";
import { getStore } from "@/lib/stores/catalog";

export const dynamic = "force-dynamic";
export default async function StoreAdmin({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = getStore(slug)!;
  const orders = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.storeSlug, slug)).orderBy(desc(schema.storeOrders.createdAt));
  const name = (sku: string | null) => s.products.find((p) => p.sku === sku)?.name ?? sku;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Orders</h1>
        <form action={async () => { "use server"; await syncDisputesAction(slug); }}>
          <button className="btn btn-ghost" disabled={!storeCreds(slug)} title={storeCreds(slug) ? "" : "Needs this store's PayPal credentials"}>Check PayPal disputes</button>
        </form>
      </div>
      {orders.length === 0 ? <p className="text-sm text-slate-500">No orders yet.</p> : (
        <table className="w-full text-left text-sm">
          <thead className="label border-b border-slate-200"><tr><th className="py-2">Order</th><th>Item ordered</th><th>Amount</th><th>Status</th><th>Shipped</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((o) => {
              const wrong = s.products.find((p) => p.sku !== o.sku && !p.sku.includes("GIFT"))!;
              return (
                <tr key={o.id}>
                  <td className="mono py-3 text-xs">{o.id}<br /><span className="text-slate-400">{o.paypalCaptureId}</span></td>
                  <td>{name(o.sku)}</td><td>{money(o.amountCents)}</td>
                  <td><span className="font-semibold">{o.status}</span>{o.disputeStatus && <span className="ml-1 text-orange-700">· dispute {o.disputeStatus}</span>}{o.note && <p className="max-w-xs text-xs text-slate-500">{o.note}</p>}</td>
                  <td className={o.shippedSku && o.shippedSku !== o.sku ? "font-semibold text-red-700" : ""}>{o.shippedSku ? name(o.shippedSku) : "—"}{o.tracking && <span className="mono block text-xs font-normal text-slate-400">{o.tracking}</span>}</td>
                  <td className="text-right">{o.status === "paid" && (
                    <div className="flex justify-end gap-2">
                      <form action={shipOrderAction.bind(null, slug, o.id, o.sku)}><button className="btn btn-ghost !py-1 !text-xs">Ship order</button></form>
                      <form action={shipOrderAction.bind(null, slug, o.id, wrong.sku)}><button className="btn btn-danger !py-1 !text-xs" title="Demo: the warehouse picks the wrong item">Ship wrong item</button></form>
                    </div>)}
                    {o.disputeStatus === "evidence submitted" && <form action={sandboxRulingAction.bind(null, slug, o.id)}><button className="btn btn-ghost !py-1 !text-xs" title="Sandbox only: stands in for PayPal's reviewer">Sandbox: PayPal rules</button></form>}</td>
                </tr>);
            })}
          </tbody>
        </table>)}
    </div>
  );
}
