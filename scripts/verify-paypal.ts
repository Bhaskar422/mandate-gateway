// Ask PayPal itself what happened to the most recent real purchase.
import { desc, isNotNull } from "drizzle-orm";
import { gatewayCreds, paypalBase, storeCreds, storePayee } from "../src/lib/config";
import { db, schema } from "../src/lib/db";
async function tok(c: { clientId: string; secret: string }) {
  return (await (await fetch(`${paypalBase()}/v1/oauth2/token`, { method: "POST", body: "grant_type=client_credentials",
    headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" } })).json()).access_token as string;
}
async function main() {
  const [p] = await db.select().from(schema.purchases).where(isNotNull(schema.purchases.paypalCaptureId)).orderBy(desc(schema.purchases.createdAt)).limit(1);
  const g = await tok(gatewayCreds()!), s = await tok(storeCreds("stride")!);
  const get = async (t: string, path: string) => { const r = await fetch(`${paypalBase()}${path}`, { headers: { Authorization: `Bearer ${t}` } }); return { status: r.status, j: await r.json() }; };
  const o = await get(g, `/v2/checkout/orders/${p.paypalOrderId}`);
  const pu = o.j.purchase_units?.[0];
  console.log("order", o.status, o.j.status, "amount", pu?.amount?.value, pu?.amount?.currency_code, "payee is Stride:", pu?.payee?.merchant_id === storePayee("stride").merchantId, "payer:", o.j.payer?.email_address?.replace(/^[^@]+/, "…"));
  const cap = pu?.payments?.captures?.[0];
  console.log("capture", cap?.status, "refunds on order:", pu?.payments?.refunds?.map((r: { id: string; status: string; amount: { value: string } }) => `${r.status} ${r.amount.value}`).join(", "));
  const c2 = await get(s, `/v2/payments/captures/${p.paypalCaptureId}`);
  console.log("capture as seen by Stride:", c2.status, c2.j.status ?? c2.j.name, "net to seller:", c2.j.seller_receivable_breakdown?.net_amount?.value);
  const rf = await get(s, `/v2/payments/refunds/${p.paypalRefundId}`);
  console.log("refund as seen by Stride:", rf.status, rf.j.status ?? rf.j.name, rf.j.amount?.value);
  process.exit(0);
}
main();
