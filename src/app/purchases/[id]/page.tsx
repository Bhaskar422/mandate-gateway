import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import LocalTime from "@/components/LocalTime";
import { db, schema } from "@/lib/db";
import { money } from "@/lib/ids";
import { evidenceBundle, verifyBundle, verifyChain } from "@/lib/ledger";
import { currentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";
const TITLES: Record<string, string> = {
  "purchase.requested": "Agent asked to buy", "purchase.decided": "Policy decision", "purchase.approved_by_user": "You approved", "purchase.declined_by_user": "You declined",
  "payment.captured": "PayPal payment captured", "payment.failed": "PayPal payment failed", "problem.reported": "You reported a problem", "refund.requested": "Refund requested from merchant",
  "refund.completed": "Refund completed", "merchant.declined": "Merchant declined", "dispute.opened": "PayPal dispute update", "dispute.evidence_submitted": "Evidence submitted to PayPal",
};

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  const [p] = await db.select().from(schema.purchases).where(and(eq(schema.purchases.id, id), eq(schema.purchases.userId, userId)));
  if (!p) notFound();
  const bundle = await evidenceBundle(id);
  const own = verifyBundle(bundle, bundle.publicKey), chain = await verifyChain();
  const ok = own.ok && chain.ok;
  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/" className="text-sm text-slate-500 underline">← Dashboard</Link>
      <h1 className="mt-3 text-2xl font-bold tracking-tight">Evidence record</h1>
      <p className="text-sm text-slate-600">{p.product?.name ?? p.productUrl}{p.amountCents > 0 && ` · ${money(p.amountCents, p.currency)}`} · <span className="mono">{p.id}</span></p>
      <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
        {ok ? `Verified. All ${bundle.entries.length} entries are signed by the gateway and the ledger chain is intact.` : `Verification failed: ${!own.ok ? own.why : !chain.ok ? `${chain.why} at entry ${chain.brokenAt}` : ""}`}
        <a className="ml-2 underline" href={`/api/purchases/${p.id}/evidence`}>Download signed record</a>
      </div>
      <ol className="mt-5 space-y-3">
        {bundle.entries.map((e) => (
          <li key={e.seq} className="card p-4">
            <div className="flex items-baseline justify-between gap-3"><h2 className="font-semibold">{TITLES[e.type] ?? e.type}</h2><LocalTime iso={e.at} className="text-xs text-slate-500" /></div>
            <details className="mt-2"><summary className="cursor-pointer text-xs text-slate-500">Record #{e.seq} · <span className="mono">{e.hash.slice(0, 20)}…</span></summary>
              <pre className="mono mt-2 max-h-96 overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">{JSON.stringify(e.payload, null, 2)}</pre>
              <p className="mono mt-2 break-all text-[10px] text-slate-400">prev {e.prevHash}<br />hash {e.hash}<br />sig {e.signature}</p>
            </details>
          </li>
        ))}
      </ol>
    </main>
  );
}
