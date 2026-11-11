// Compare what the gateway's ledger says about a purchase with what PayPal says about the same order.
// Read-only: it changes nothing on either side.
import { and, eq } from "drizzle-orm";
import { paypalSimulated } from "./config";
import { db, schema } from "./db";
import { getOrder } from "./paypal";

export type ReconcileRow = { what: string; gateway: string; paypal: string; match: boolean };
type Money = { value?: string; currency_code?: string };
type PayPalOrder = { id?: string; status?: string; intent?: string; purchase_units?: { custom_id?: string; amount?: Money; payee?: { merchant_id?: string; email_address?: string };
  payments?: { captures?: { id: string; status: string; amount?: Money }[]; authorizations?: { id: string; status: string }[]; refunds?: { id: string; status: string; amount?: Money }[] } }[] };
const cents = (m?: Money) => Math.round(Number(m?.value ?? 0) * 100);
const usd = (c: number, cur: string) => `${(c / 100).toFixed(2)} ${cur}`;

export async function reconcilePurchase(userId: string, purchaseId: string): Promise<{ checkedAt: string; rows: ReconcileRow[]; ok: boolean; note?: string }> {
  const [p] = await db.select().from(schema.purchases).where(and(eq(schema.purchases.id, purchaseId), eq(schema.purchases.userId, userId)));
  if (!p) throw new Error("Purchase not found");
  if (!p.paypalOrderId) throw new Error("This purchase never reached PayPal, so there is nothing to compare");
  const checkedAt = new Date().toISOString();
  if (paypalSimulated() || p.paypalOrderId.startsWith("SIM-")) return { checkedAt, rows: [], ok: true, note: "Payments are simulated on this deployment, so there is no PayPal record to compare with." };
  const [m] = p.merchantId ? await db.select().from(schema.merchants).where(eq(schema.merchants.id, p.merchantId)) : [];
  const o = (await getOrder(p.paypalOrderId)) as PayPalOrder;
  const u = o.purchase_units?.[0], cap = u?.payments?.captures?.[0], auth = u?.payments?.authorizations?.[0];
  const refunded = (u?.payments?.refunds ?? []).filter((r) => r.status === "COMPLETED").reduce((s, r) => s + cents(r.amount), 0);
  const row = (what: string, gateway: string, paypal: string, match = gateway === paypal): ReconcileRow => ({ what, gateway, paypal, match });

  const rows: ReconcileRow[] = [
    row("Order", p.paypalOrderId, o.id ?? "not found"),
    row("Our purchase id on the PayPal order", p.id, u?.custom_id ?? "none"),
    row("Amount", usd(p.amountCents, p.currency), usd(cents(u?.amount), u?.amount?.currency_code ?? "?")),
  ];
  const payeeOurs = m?.paypalMerchantId ?? m?.paypalEmail ?? "none", payeeTheirs = m?.paypalMerchantId ? u?.payee?.merchant_id : u?.payee?.email_address;
  rows.push(row(`Paid to ${m?.name ?? "the store"}`, payeeOurs, payeeTheirs ?? "none"));
  if (p.status === "authorized" || p.status === "cancelled") {
    rows.push(row("Reservation", p.paypalAuthorizationId ?? "none", auth?.id ?? "none"));
    const want = p.status === "authorized" ? ["CREATED", "PENDING"] : ["VOIDED"];
    rows.push(row("Reservation state", p.status === "authorized" ? "held, not charged" : "released", auth?.status ?? "none", !!auth && want.includes(auth.status)));
  } else {
    rows.push(row("Capture", p.paypalCaptureId ?? "none", cap?.id ?? "none"));
    const expect = p.status === "refunded" ? ["REFUNDED"] : p.status === "partially_refunded" ? ["PARTIALLY_REFUNDED"] : ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"];
    rows.push(row("Capture state", p.status.replace(/_/g, " "), cap?.status ?? "none", !!cap && expect.includes(cap.status)));
    rows.push(row("Refunded so far", usd(p.refundedCents, p.currency), usd(refunded, p.currency)));
  }
  return { checkedAt, rows, ok: rows.every((r) => r.match) };
}
