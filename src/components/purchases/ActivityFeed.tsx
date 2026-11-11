"use client";
import { Download, Search, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import type { PurchaseView } from "@/lib/views";
import { useAccount } from "../AccountProvider";
import { EmptyState, PageHeader } from "../ui/Layout";
import PurchaseCard from "./PurchaseCard";

export type ActivityFilters = { status: string; agent: string; merchant: string; flagged: boolean; q: string };

const needsYou = (p: PurchaseView) => p.status === "pending_approval" || p.case?.status === "offer_pending";
const GROUPS: { key: string; label: string; match: (p: PurchaseView) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "needs_you", label: "Needs you", match: needsYou },
  { key: "paid", label: "Paid", match: (p) => ["captured", "authorized", "paying"].includes(p.status) },
  { key: "blocked", label: "Blocked", match: (p) => p.status === "blocked" },
  { key: "problems", label: "Refunds and problems", match: (p) => ["refund_requested", "refunded", "partially_refunded", "disputed"].includes(p.status) || !!p.case },
  { key: "not_completed", label: "Declined or failed", match: (p) => ["declined", "payment_failed"].includes(p.status) },
];

/** The full purchase feed, filterable. Everything an agent ever asked for is here, paid or not. */
export default function ActivityFeed({ initial }: { initial: Partial<ActivityFilters> }) {
  const { state } = useAccount();
  const [f, setF] = useState<ActivityFilters>({ status: GROUPS.some((g) => g.key === initial.status) ? initial.status! : "all", agent: initial.agent ?? "", merchant: initial.merchant ?? "", flagged: !!initial.flagged, q: initial.q ?? "" });
  const set = (patch: Partial<ActivityFilters>) => setF((x) => ({ ...x, ...patch }));

  const merchants = useMemo(() => [...new Set(state.purchases.map((p) => p.merchant).filter((m): m is string => !!m))].sort(), [state.purchases]);
  const scoped = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return state.purchases.filter((p) =>
      (!f.agent || p.agentId === f.agent) && (!f.merchant || p.merchant === f.merchant) && (!f.flagged || p.injectionFlag) &&
      (!q || [p.productName, p.merchant, p.agent, p.mandateName, p.reason, p.userRequest, p.sku, p.id, p.productUrl].some((v) => v?.toLowerCase().includes(q))));
  }, [state.purchases, f.agent, f.merchant, f.flagged, f.q]);
  const group = GROUPS.find((g) => g.key === f.status) ?? GROUPS[0];
  const shown = scoped.filter(group.match);
  const filtered = f.status !== "all" || !!f.agent || !!f.merchant || f.flagged || !!f.q.trim();

  return (
    <>
      <PageHeader title="Activity" lead="Every purchase your agents asked for, including the ones that were blocked."
        actions={<a href="/api/export/purchases.csv" className="btn btn-secondary" download><Download size={15} aria-hidden />Export CSV</a>} />

      <div className="mb-5 space-y-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {GROUPS.map((g) => {
            const n = scoped.filter(g.match).length, on = f.status === g.key;
            return (
              <button key={g.key} type="button" aria-pressed={on} onClick={() => set({ status: g.key })}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors ${on ? "border-ink bg-ink text-bg" : "border-line-strong bg-surface text-ink-2 hover:bg-sunken"}`}>
                {g.label}<span className={`num text-xs ${on ? "opacity-80" : "text-ink-3"}`}>{n}</span>
              </button>
            );
          })}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
            <input type="search" className="field !pl-9" placeholder="Search products, stores, reasons" aria-label="Search activity" value={f.q} onChange={(e) => set({ q: e.target.value })} />
          </div>
          <select className="field" aria-label="Filter by agent" value={f.agent} onChange={(e) => set({ agent: e.target.value })}>
            <option value="">All agents</option>
            {state.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="field" aria-label="Filter by store" value={f.merchant} onChange={(e) => set({ merchant: e.target.value })}>
            <option value="">All stores</option>
            {merchants.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <label className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${f.flagged ? "tone-flag tone-softbg tone-text border-transparent" : "border-line-strong bg-surface text-ink-2"}`}>
            <input type="checkbox" checked={f.flagged} onChange={(e) => set({ flagged: e.target.checked })} />
            <ShieldAlert size={14} aria-hidden />Injection attempts only
          </label>
        </div>
      </div>

      <p className="mb-3 text-sm text-ink-3" role="status">
        {shown.length} of {state.purchases.length} shown
        {filtered && <> · <button type="button" className="link" onClick={() => setF({ status: "all", agent: "", merchant: "", flagged: false, q: "" })}>Clear filters</button></>}
      </p>

      {state.purchases.length === 0 ? (
        <EmptyState title="No activity yet">When a connected agent asks the gateway to buy something, the request appears here within a few seconds, with the decision and the reason.</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing matches these filters">Try a different status, or clear the filters to see everything.</EmptyState>
      ) : (
        <div className="space-y-3">{shown.map((p) => <PurchaseCard key={p.id} p={p} />)}</div>
      )}
    </>
  );
}
