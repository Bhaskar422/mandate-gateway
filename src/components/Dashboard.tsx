"use client";
import { useEffect, useState, useTransition } from "react";
import { approvalAction, compileMandateAction, confirmMandateAction, createAgentAction, reportProblemAction, revokeMandateAction } from "@/app/actions";
import LocalTime from "@/components/LocalTime";
import type { MandateRules } from "@/lib/rules";
import type { DashboardState } from "@/lib/views";

const money = (c: number, cur = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(c / 100);
type Purchase = DashboardState["purchases"][number];


const STATUS: Record<string, { label: string; cls: string }> = {
  captured: { label: "Approved · paid", cls: "bg-emerald-100 text-emerald-800" },
  blocked: { label: "Blocked", cls: "bg-red-100 text-red-800" },
  pending_approval: { label: "Needs your approval", cls: "bg-amber-100 text-amber-900" },
  paying: { label: "Paying…", cls: "bg-sky-100 text-sky-800" },
  payment_failed: { label: "Payment failed", cls: "bg-red-100 text-red-800" },
  declined: { label: "Declined by you", cls: "bg-slate-200 text-slate-700" },
  refund_requested: { label: "Refund requested", cls: "bg-violet-100 text-violet-800" },
  refunded: { label: "Refunded", cls: "bg-violet-100 text-violet-800" },
  disputed: { label: "In dispute", cls: "bg-orange-100 text-orange-800" },
};

export default function Dashboard({ initial, notice }: { initial: DashboardState; notice: { kind: string; detail: string | null } | null }) {
  const [s, setS] = useState(initial);
  useEffect(() => setS(initial), [initial]);
  useEffect(() => {
    const t = setInterval(async () => { try { const r = await fetch("/api/activity", { cache: "no-store" }); if (r.ok) setS(await r.json()); } catch {} }, 2500);
    return () => clearInterval(t);
  }, []);
  const refresh = async () => { const r = await fetch("/api/activity", { cache: "no-store" }); if (r.ok) setS(await r.json()); };

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mandate</h1>
          <p className="text-sm text-slate-600">PayPal made agents able to pay. This makes it safe to let them.</p>
        </div>
        <nav className="flex gap-4 text-sm text-slate-600">
          <a className="hover:underline" href="/stores/stride" target="_blank">Stride store ↗</a>
          <a className="hover:underline" href="/stores/kickz" target="_blank">Kickz store ↗</a>
        </nav>
      </header>
      {s.simulated && <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"><b>Simulated payments.</b> No PayPal credentials are configured, so no money moves. Add sandbox credentials to go live.</p>}
      {notice && <p className={`mb-4 rounded-lg border px-4 py-2 text-sm ${notice.kind === "linked" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
        {notice.kind === "linked" ? "PayPal linked. Your agents can now pay within your mandate." : notice.kind === "cancelled" ? "PayPal linking was cancelled." : `PayPal linking failed: ${notice.detail ?? "unknown error"}`}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-5">
          <PayPalCard s={s} />
          <MandateCard s={s} onChange={refresh} />
          <AgentsCard s={s} onChange={refresh} />
          <LedgerCard />
        </div>
        <section>
          <h2 className="label mb-2">Activity</h2>
          {s.purchases.length === 0
            ? <div className="card p-8 text-center text-sm text-slate-500">Nothing yet. Connect an agent and ask it to buy something.</div>
            : <ul className="space-y-3">{s.purchases.map((p) => <PurchaseCard key={p.id} p={p} onChange={refresh} />)}</ul>}
        </section>
      </div>
    </main>
  );
}

function PayPalCard({ s }: { s: DashboardState }) {
  return (
    <section className="card p-5">
      <h2 className="label mb-2">1 · Payment method</h2>
      {s.paypal
        ? <div className="flex items-center justify-between gap-3"><p className="text-sm"><span className="font-semibold">PayPal linked</span><br /><span className="text-slate-600">{s.paypal.email ?? "Sandbox buyer"}</span></p><a href="/api/paypal/link" className="btn btn-ghost">Relink</a></div>
        : <div className="flex items-center justify-between gap-3"><p className="text-sm text-slate-600">Link PayPal once. Agents never see your payment details.</p><a href="/api/paypal/link" className="btn btn-primary shrink-0">Link PayPal</a></div>}
    </section>
  );
}

function RulesTable({ r }: { r: MandateRules }) {
  const rows: [string, React.ReactNode][] = [
    ["Total limit", money(r.totalLimitCents, r.currency)],
    ["Per purchase", r.perPurchaseLimitCents === null ? "No separate limit" : money(r.perPurchaseLimitCents, r.currency)],
    ["Ask me above", r.approvalThresholdCents === null ? "Never ask" : money(r.approvalThresholdCents, r.currency)],
    ["May buy", r.allowedCategories.join(", ")],
    ["Merchants", r.merchantPolicy === "verified_only" ? "Verified merchants only" : r.merchantPolicy === "allowlist" ? r.allowedMerchants.join(", ") : "Any registered merchant"],
    ["Purchases", r.maxPurchases === null ? "No count limit" : `At most ${r.maxPurchases}`],
    ["Expires", <LocalTime key="e" iso={r.expiresAt} />],
    ["Always blocked", "Gift cards, prepaid cards, crypto, money transfers"],
  ];
  return <dl className="divide-y divide-slate-100 text-sm">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-1.5"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}</dl>;
}

function MandateCard({ s, onChange }: { s: DashboardState; onChange: () => void }) {
  const [text, setText] = useState("Up to $150 on running shoes, known merchants only, ask me above $100.");
  const [draft, setDraft] = useState<MandateRules | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const m = s.mandate;
  if (m) {
    const pct = Math.min(100, (m.spentCents / m.rules.totalLimitCents) * 100);
    return (
      <section className="card p-5">
        <div className="mb-2 flex items-center justify-between"><h2 className="label">2 · Active mandate</h2>
          <button className="btn btn-danger !py-1 !text-xs" disabled={busy} onClick={() => start(async () => { await revokeMandateAction(); onChange(); })}>Revoke</button></div>
        <p className="mb-3 text-sm italic text-slate-700">“{m.sourceText}”</p>
        <div className="mb-3">
          <div className="mb-1 flex justify-between text-xs text-slate-600"><span>{money(m.spentCents, m.rules.currency)} committed</span><span>{money(m.rules.totalLimitCents - m.spentCents, m.rules.currency)} left</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-slate-900" style={{ width: `${pct}%` }} /></div>
        </div>
        <RulesTable r={m.rules} />
      </section>
    );
  }
  return (
    <section className="card p-5">
      <h2 className="label mb-2">2 · Mandate</h2>
      {!draft ? <>
        <p className="mb-2 text-sm text-slate-600">Say what your agent may buy, in plain English.</p>
        <textarea className="w-full rounded-lg border border-slate-300 p-3 text-sm" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-primary mt-2" disabled={busy} onClick={() => start(async () => { setErr(null); const r = await compileMandateAction(text); if (r.ok) { setDraft(r.rules); setWarnings(r.warnings); } else setErr(r.error); })}>{busy ? "Reading…" : "Turn into rules"}</button>
      </> : <>
        <p className="mb-2 text-sm text-slate-600">This is how your mandate will be enforced. Confirm only if it is right.</p>
        <p className="mb-2 rounded-lg bg-slate-50 p-3 text-sm">{draft.summary}</p>
        <RulesTable r={draft} />
        {warnings.map((w) => <p key={w} className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">{w}</p>)}
        <div className="mt-3 flex gap-2">
          <button className="btn btn-primary" disabled={busy} onClick={() => start(async () => { setErr(null); const r = await confirmMandateAction(text, draft); if (r.ok) { setDraft(null); onChange(); } else setErr(r.error); })}>Confirm mandate</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => setDraft(null)}>Edit</button>
        </div>
      </>}
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
    </section>
  );
}

function AgentsCard({ s, onChange }: { s: DashboardState; onChange: () => void }) {
  const [name, setName] = useState("Claude");
  const [key, setKey] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const cfg = key && JSON.stringify({ mcpServers: {
    mandate: { command: "npx", args: ["-y", "mcp-remote", `${s.appUrl}/api/mcp`, "--header", `Authorization: Bearer ${key}`] },
    "stride-store": { command: "npx", args: ["-y", "mcp-remote", `${s.appUrl}/stores/stride/mcp`] },
    "kickz-store": { command: "npx", args: ["-y", "mcp-remote", `${s.appUrl}/stores/kickz/mcp`] },
  } }, null, 2);
  return (
    <section className="card p-5">
      <h2 className="label mb-2">3 · Agents</h2>
      <div className="flex gap-2">
        <input className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" />
        <button className="btn btn-primary shrink-0" disabled={busy} onClick={() => start(async () => { const r = await createAgentAction(name); if (r.ok) { setKey(r.key); onChange(); } })}>Connect agent</button>
      </div>
      {key && cfg && <div className="mt-3">
        <p className="mb-1 text-xs text-slate-600">Shown once. Add this to your agent&apos;s MCP config:</p>
        <pre className="mono max-h-56 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{cfg}</pre>
        <button className="btn btn-ghost mt-2 !py-1 !text-xs" onClick={() => navigator.clipboard.writeText(cfg)}>Copy</button>
      </div>}
      {s.agents.length > 0 && <ul className="mt-3 divide-y divide-slate-100 text-sm">{s.agents.map((a) => <li key={a.id} className="flex justify-between py-1.5"><span className="font-medium">{a.name}</span><span className="mono text-xs text-slate-500">{a.keyPrefix}…</span></li>)}</ul>}
    </section>
  );
}

function LedgerCard() {
  const [r, setR] = useState<{ ok: boolean; entries?: number; head?: string; brokenAt?: number; why?: string } | null>(null);
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="label">Evidence ledger</h2><p className="text-sm text-slate-600">Every decision is hash-chained and signed.</p></div>
        <button className="btn btn-ghost shrink-0" onClick={async () => setR(await (await fetch("/api/ledger/verify")).json())}>Verify chain</button>
      </div>
      {r && <p className={`mt-2 text-sm ${r.ok ? "text-emerald-700" : "text-red-700"}`}>{r.ok ? <>Intact: {r.entries} entries. Head <span className="mono">{r.head?.slice(0, 16)}…</span></> : `Broken at entry ${r.brokenAt}: ${r.why}`}</p>}
    </section>
  );
}

function PurchaseCard({ p, onChange }: { p: Purchase; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [report, setReport] = useState("The wrong item arrived.");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const st = STATUS[p.status] ?? { label: p.status, cls: "bg-slate-200" };
  const failed = p.checks.filter((c) => !c.passed);
  return (
    <li className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{p.productName ?? p.productUrl}</p>
          <p className="text-xs text-slate-500">{[p.merchant ?? "Unknown merchant", p.agent && `via ${p.agent}`].filter(Boolean).join(" · ")} · <LocalTime iso={p.createdAt} timeOnly /></p>
        </div>
        <div className="shrink-0 text-right">
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
          {p.amountCents > 0 && <p className="mt-1 text-sm font-semibold">{money(p.amountCents, p.currency)}</p>}
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-700">{p.reason}</p>
      {p.caseMessage?.reason && <p className="mt-1 text-sm text-violet-800">Merchant: {p.caseMessage.reason}</p>}
      <p className="mt-1 text-xs text-slate-500">Asked: “{p.userRequest}”</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {p.status === "pending_approval" && <>
          <button className="btn btn-primary" disabled={busy} onClick={() => start(async () => { const r = await approvalAction(p.id, true); if (!r.ok) setMsg(r.error); onChange(); })}>Approve {money(p.amountCents, p.currency)}</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => start(async () => { await approvalAction(p.id, false); onChange(); })}>Decline</button>
        </>}
        {p.status === "captured" && !reporting && <button className="btn btn-ghost" onClick={() => setReporting(true)}>Report a problem</button>}
        <button className="text-xs text-slate-500 underline" onClick={() => setOpen(!open)}>{open ? "Hide checks" : `${p.checks.length} checks${failed.length ? `, ${failed.length} failed` : ""}`}</button>
        <a className="text-xs text-slate-500 underline" href={`/purchases/${p.id}`}>Evidence record</a>
      </div>
      {reporting && <div className="mt-3">
        <textarea className="w-full rounded-lg border border-slate-300 p-2 text-sm" rows={2} value={report} onChange={(e) => setReport(e.target.value)} />
        <div className="mt-2 flex gap-2">
          <button className="btn btn-primary" disabled={busy} onClick={() => start(async () => { const r = await reportProblemAction(p.id, report); setMsg(r.ok ? r.message : r.error); setReporting(false); onChange(); })}>{busy ? "Working…" : "Send with evidence"}</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => setReporting(false)}>Cancel</button>
        </div>
      </div>}
      {msg && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm">{msg}</p>}
      {open && <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs">{p.checks.map((c, i) => (
        <li key={i} className="flex gap-2"><span className={c.passed ? "text-emerald-600" : "text-red-600"}>{c.passed ? "✓" : "✕"}</span>
          <span className="mono w-40 shrink-0 text-slate-500">{c.rule}</span><span className="min-w-0 flex-1">{c.detail}</span>
          <span className="shrink-0 text-slate-400">{c.enforcedBy}</span></li>))}</ul>}
    </li>
  );
}
