import { Ban, Bot, Hand, Lightbulb, Wallet } from "lucide-react";
import type { InsightDay, LostDemand, MerchantInsights, ProductLine } from "@/lib/merchant-insights";
import { money, plural, shortDay } from "../format";
import { Badge } from "../ui/Badge";
import { EmptyState, Fact } from "../ui/Layout";

function Stat({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: string; note: string; tone: string }) {
  return (
    <div className="card min-w-0 p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-ink-2"><span className={`tone-${tone} tone-mark`}>{icon}</span>{label}</p>
      <p className="display num mt-2 text-2xl text-ink [overflow-wrap:anywhere] sm:text-3xl">{value}</p>
      <p className="mt-1 text-sm text-ink-3">{note}</p>
    </div>
  );
}

const W = 560, H = 190, PAD_X = 6, MID = 112, TOP = 14, BOTTOM = H - 22;

/** Fourteen days: money from paid orders rises above the axis, blocked requests hang below it. Each half has its own scale. */
function DailyChart({ days, currency }: { days: InsightDay[]; currency: string }) {
  const maxPaid = Math.max(...days.map((d) => d.revenueCents), 1);
  const maxBlocked = Math.max(...days.map((d) => d.blockedRequests), 1);
  const step = (W - PAD_X * 2) / days.length;
  const bar = Math.min(22, step * 0.58);
  const paid = days.reduce((s, d) => s + d.revenueCents, 0), orders = days.reduce((s, d) => s + d.paidOrders, 0), blocked = days.reduce((s, d) => s + d.blockedRequests, 0);
  const summary = `${money(paid, currency)} from ${plural(orders, "paid order")}, ${plural(blocked, "blocked request")} in the last 14 days`;
  return (
    <figure>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-ink-2">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-ok" aria-hidden />Paid orders, by amount</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-bad" aria-hidden />Blocked requests, by count</span>
        </div>
        <p className="num text-ink-2">{summary}</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="img" aria-label={`Agent orders by day. ${summary}.`}>
        <line x1={PAD_X} x2={W - PAD_X} y1={MID} y2={MID} stroke="var(--line-strong)" strokeWidth="1" />
        {paid > 0 && <text x={PAD_X} y={TOP - 3} fontSize="10" fill="var(--ink-3)">{money(maxPaid, currency)}</text>}
        {paid > 0 && <line x1={PAD_X} x2={W - PAD_X} y1={TOP} y2={TOP} stroke="var(--line)" strokeDasharray="2 4" />}
        {days.map((d, i) => {
          const x = PAD_X + i * step + (step - bar) / 2;
          const up = Math.max((d.revenueCents / maxPaid) * (MID - TOP - 2), 2);
          const down = Math.max((d.blockedRequests / maxBlocked) * (BOTTOM - MID - 14), 2);
          return (
            <g key={d.day}>
              <title>{`${shortDay(d.day)}: ${money(d.revenueCents, currency)} from ${plural(d.paidOrders, "paid order")}, ${plural(d.blockedRequests, "blocked request")}`}</title>
              <rect x={PAD_X + i * step} y={0} width={step} height={H} fill="transparent" />
              {d.revenueCents > 0 && <rect x={x} y={MID - 1 - up} width={bar} height={up} rx="3" fill="var(--ok)" />}
              {d.blockedRequests > 0 && <rect x={x} y={MID + 1} width={bar} height={down} rx="3" fill="var(--bad)" />}
              {d.blockedRequests > 0 && <text x={x + bar / 2} y={MID + 1 + down + 11} fontSize="10" textAnchor="middle" fill="var(--ink-2)">{d.blockedRequests}</text>}
              {i % 2 === 1 && <text x={x + bar / 2} y={H - 4} fontSize="10" textAnchor="middle" fill="var(--ink-3)">{shortDay(d.day)}</text>}
            </g>
          );
        })}
      </svg>
      {paid === 0 && blocked === 0 && <figcaption className="mt-1 text-center text-sm text-ink-3">No paid orders or blocked requests in the last 14 days.</figcaption>}
    </figure>
  );
}

function LostRow({ g, max, currency }: { g: LostDemand; max: number; currency: string }) {
  const tone = g.side === "store" ? "warn" : "neutral";
  return (
    <li>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-base">
        <span className="min-w-0 text-ink">{g.label}</span>
        <span className="num text-ink-2"><span className="font-semibold text-ink">{g.count}</span>{g.valueCents > 0 ? ` · ${money(g.valueCents, currency)}` : " · value not known"}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-sunken" aria-hidden>
        <div className={`tone-${tone} tone-fill h-1.5 rounded-full`} style={{ width: `${Math.max((g.count / max) * 100, 3)}%` }} />
      </div>
    </li>
  );
}

function LostGroup({ title, hint, rows, max, currency }: { title: string; hint: string; rows: LostDemand[]; max: number; currency: string }) {
  if (rows.length === 0) return null;
  const count = rows.reduce((s, g) => s + g.count, 0), value = rows.reduce((s, g) => s + g.valueCents, 0);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h4 className="font-semibold text-ink">{title}</h4>
        <p className="num text-sm text-ink-2">{plural(count, "request")}{value > 0 ? `, ${money(value, currency)}` : ""}</p>
      </div>
      <p className="mb-3 text-sm text-ink-3">{hint}</p>
      <ul className="space-y-3">{rows.map((g) => <LostRow key={g.rule} g={g} max={max} currency={currency} />)}</ul>
    </div>
  );
}

function Products({ title, empty, rows, value }: { title: string; empty: string; rows: ProductLine[]; value: (l: ProductLine) => React.ReactNode }) {
  return (
    <div className="card min-w-0 p-4 sm:p-5">
      <h3 className="font-semibold text-ink">{title}</h3>
      {rows.length === 0 ? <p className="mt-2 text-sm text-ink-3">{empty}</p> : (
        <ol className="mt-2 divide-y divide-line">
          {rows.map((l) => (
            <li key={l.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-base">
              <span className="min-w-0 text-ink [overflow-wrap:anywhere]">{l.name}</span>
              <span className="num text-ink-2">{value(l)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const ISSUE: Record<string, string> = { wrong_item: "Wrong item", not_as_described: "Not as described", damaged: "Damaged", not_received: "Not received", changed_mind: "Changed mind" };
const issueLabel = (s: string) => ISSUE[s] ?? (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, " ");

/** What agents did at one store: requests, money, what was blocked and why, and what happened after the sale. Aggregates only. */
export default function Insights({ insights: i }: { insights: MerchantInsights }) {
  const cur = i.currency;
  const { requests: r, revenue: v, afterSale: a } = i;
  if (r.total === 0) {
    return (
      <EmptyState icon={<Bot size={18} aria-hidden />} title="No agent requests yet">
        {i.merchant.standing === "pending"
          ? "Agents cannot buy here until the store has proved it owns its site. After that, every request an agent makes for one of your products is counted here, paid or not."
          : i.merchant.standing === "registered"
            ? "The store is registered, so agents can buy here for buyers whose rules name it or accept any registered store. Every request for one of your products is counted here, paid or not."
            : "The store is verified, so agents can buy here under any rules that allow verified stores. Every request for one of your products is counted here, paid or not."}
      </EmptyState>
    );
  }
  const store = i.lost.byRule.filter((g) => g.side === "store"), buyer = i.lost.byRule.filter((g) => g.side === "buyer");
  const max = Math.max(...i.lost.byRule.map((g) => g.count), 1);
  const d = a.disputes;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat tone="ok" icon={<Wallet size={16} aria-hidden />} label="Revenue from agents" value={money(v.netCents, cur)}
          note={`${plural(r.paid, "paid order")}${v.refundedCents ? `, after ${money(v.refundedCents, cur)} refunded` : ""}`} />
        <Stat tone="info" icon={<Bot size={16} aria-hidden />} label="Agent requests" value={String(r.total)}
          note={`From ${plural(i.distinctAgents, "agent")} acting for ${plural(i.distinctBuyers, "buyer")}`} />
        <Stat tone="bad" icon={<Ban size={16} aria-hidden />} label="Blocked requests" value={String(r.blocked)}
          note={r.blocked === 0 ? "No request has been blocked" : i.lost.valueCents > 0 ? `${money(i.lost.valueCents, cur)} that was not paid` : "The gateway could not read a price for these"} />
        <Stat tone="warn" icon={<Hand size={16} aria-hidden />} label="Waiting for the buyer" value={String(r.waitingApproval)}
          note={r.waitingApproval ? `${money(v.waitingApprovalCents, cur)} that the buyer has to approve` : "No request is waiting for approval"} />
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-[12px] border border-line bg-raised p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="Paid before refunds"><span className="num">{money(v.grossCents, cur)}</span></Fact>
        <Fact label="Refunded"><span className="num">{money(v.refundedCents, cur)}</span></Fact>
        <Fact label="Average paid order"><span className="num">{r.paid ? money(v.averageOrderCents, cur) : "None yet"}</span></Fact>
        <Fact label="Reserved, not charged"><span className="num">{r.reserved ? `${r.reserved} · ${money(v.reservedCents, cur)}` : "0"}</span></Fact>
        <Fact label="Declined by the buyer"><span className="num">{r.declined}</span></Fact>
        <Fact label="Failed or cancelled"><span className="num">{r.other}</span></Fact>
      </dl>

      {i.suggestions.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold text-ink">What to do next</h3>
          <ul className="space-y-2">
            {i.suggestions.map((s) => (
              <li key={s.id} className={`tone-${s.tone} tone-softbg flex gap-3 rounded-[12px] p-3 sm:p-4`}>
                <Lightbulb size={17} className="tone-mark mt-0.5 shrink-0" aria-hidden />
                <p className="min-w-0 text-base text-ink"><span className="tone-text font-semibold">{s.title}.</span> {s.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-4 sm:p-5">
        <h3 className="mb-3 font-semibold text-ink">Last 14 days</h3>
        <DailyChart days={i.daily} currency={cur} />
      </div>

      <div className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 className="font-semibold text-ink">Requests the gateway blocked</h3>
          {r.blocked > 0 && <p className="num text-sm text-ink-2">{plural(r.blocked, "request")}{i.lost.valueCents > 0 ? `, ${money(i.lost.valueCents, cur)}` : ""}</p>}
        </div>
        <p className="text-sm text-ink-3">Each blocked request is counted once, under the first check it failed.</p>
        {r.blocked === 0 ? <p className="mt-3 text-base text-ink-2">No request for this store&apos;s products has been blocked.</p> : (
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <LostGroup title="Things the store can change" hint="Your standing with the gateway and your product pages." rows={store} max={max} currency={cur} />
            <LostGroup title="The buyer's own rules" hint="Budgets, allowed products, paused agents. The store cannot change these." rows={buyer} max={max} currency={cur} />
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Products title="Products agents bought most" empty="No paid orders yet." rows={i.topPaid} value={(l) => <><span className="font-semibold text-ink">{plural(l.paidOrders, "paid order")}</span> · {money(l.revenueCents, cur)}</>} />
        <Products title="Products blocked most" empty="No blocked requests." rows={i.topBlocked} value={(l) => <><span className="font-semibold text-ink">{l.blockedRequests} blocked</span>{l.blockedCents > 0 ? ` · ${money(l.blockedCents, cur)}` : ""}</>} />
      </div>

      <div className="card p-4 sm:p-5">
        <h3 className="font-semibold text-ink">After the sale</h3>
        {a.problems === 0 && d.opened === 0 ? <p className="mt-2 text-base text-ink-2">No buyer has reported a problem with an agent order, and no dispute has been opened.</p> : (
          <>
            <p className="text-sm text-ink-3">{plural(a.problems, "problem")} reported on {plural(r.paid, "paid order")}. How each one ended:</p>
            <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <Fact label="Full refund"><span className="num">{a.fullRefund}</span></Fact>
              <Fact label="Partial refund"><span className="num">{a.partialRefund}</span></Fact>
              <Fact label="Replacement sent"><span className="num">{a.replacement}</span></Fact>
              <Fact label="Declined by the store"><span className="num">{a.declined}</span></Fact>
              <Fact label="Still open"><span className="num">{a.open}</span></Fact>
            </dl>
            {a.issues.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="eyebrow mb-1.5">What buyers reported</p>
                <div className="flex flex-wrap gap-1.5">{a.issues.map((x) => <Badge key={x.issue}>{issueLabel(x.issue)}: {x.count}</Badge>)}</div>
              </div>
            )}
            <div className="mt-4 border-t border-line pt-3">
              <p className="eyebrow mb-1.5">PayPal disputes</p>
              {d.opened === 0 ? <p className="text-base text-ink-2">None opened.</p> : (
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="dispute">Opened: {d.opened}</Badge>
                  <Badge tone="ok">Decided for the store: {d.won}</Badge>
                  <Badge tone="bad">Decided for the buyer: {d.lost}</Badge>
                  <Badge>Not decided yet: {d.open}</Badge>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <p className="text-sm text-ink-3">These are totals from the gateway&apos;s records of every agent request for this store. Buyers and agents are counted, never named.</p>
    </div>
  );
}
