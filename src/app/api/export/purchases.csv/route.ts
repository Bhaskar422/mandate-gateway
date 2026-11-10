import { currentUserId } from "@/lib/session";
import { dashboardState } from "@/lib/views";

// Every purchase attempt for the signed-in user, as CSV.
export const dynamic = "force-dynamic";
export async function GET() {
  const userId = await currentUserId().catch(() => null);
  if (!userId) return Response.json({ error: "No session" }, { status: 401 });
  const s = await dashboardState(userId);
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
  const head = ["created_at", "purchase_id", "status", "product", "sku", "merchant", "agent", "mandate", "quantity", "amount", "refunded", "currency", "decision", "reason", "injection_flag", "paypal_order_id", "user_request"];
  const rows = s.purchases.map((p) => [p.createdAt, p.id, p.status, p.productName, p.sku, p.merchant, p.agent, p.mandateName ?? p.mandateId, p.quantity, (p.amountCents / 100).toFixed(2), (p.refundedCents / 100).toFixed(2), p.currency,
    p.outcome, p.reason, p.injectionFlag ? "yes" : "no", p.paypalOrderId, p.userRequest]);
  return new Response([head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="mandate-purchases.csv"' } });
}
