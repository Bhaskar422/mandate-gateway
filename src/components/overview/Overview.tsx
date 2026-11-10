"use client";
import { ArrowRight, Ban, CircleCheck, Hand, PauseCircle, ShieldAlert, Wallet } from "lucide-react";
import Link from "next/link";
import { useAccount } from "../AccountProvider";
import { checkFailed, isAutoPause, money, plural } from "../format";
import PurchaseCard from "../purchases/PurchaseCard";
import Banner from "../ui/Banner";
import { EmptyState, PageHeader, Section } from "../ui/Layout";
import Meter from "../ui/Meter";
import ActivityChart from "./ActivityChart";
import { SetupChecklist, Welcome } from "./Onboarding";

function Stat({ icon, label, value, note, tone, href }: { icon: React.ReactNode; label: string; value: string; note: string; tone: string; href: string }) {
  return (
    <Link href={href} className="card group block p-4 transition-shadow hover:shadow-card sm:p-5">
      <p className="flex items-center gap-2 text-sm font-medium text-ink-2"><span className={`tone-${tone} tone-mark`}>{icon}</span>{label}</p>
      <p className="display num mt-2 text-3xl text-ink">{value}</p>
      <p className="mt-1 text-sm text-ink-3">{note}</p>
    </Link>
  );
}

/** The home page. A new account sees the welcome; an active one sees what needs it first, then the numbers. */
export default function Overview({ notice }: { notice: { kind: string; detail: string | null } | null }) {
  const { state } = useAccount();
  const { stats } = state;
  const fresh = !state.paypal && state.mandates.length === 0 && state.agents.length === 0 && state.purchases.length === 0;

  const paypalNotice = notice && (
    <Banner className="mb-5" role="status" tone={notice.kind === "linked" ? "ok" : notice.kind === "cancelled" ? "neutral" : "bad"} icon={<Wallet size={17} aria-hidden />}
      title={notice.kind === "linked" ? "PayPal linked" : notice.kind === "cancelled" ? "PayPal linking was cancelled" : "PayPal linking failed"}>
      {notice.kind === "linked" ? "Your agents can now pay within your mandates." : notice.kind === "cancelled" ? "Nothing was saved. You can try again whenever you like." : notice.detail ?? "PayPal returned an error. Try again."}
    </Banner>
  );
  if (fresh) return <>{paypalNotice}<Welcome /></>;

  const approvals = state.purchases.filter((p) => p.status === "pending_approval");
  const offers = state.purchases.filter((p) => p.case?.status === "offer_pending");
  const autoPaused = state.agents.filter((a) => a.status === "paused" && isAutoPause(a.pauseReason));
  const attention = approvals.length + offers.length + autoPaused.length;
  const maxReason = Math.max(...stats.blockReasons.map((r) => r.count), 1);
  const liveAgents = state.agents.filter((a) => a.status === "active").length;

  return (
    <>
      <PageHeader title="Overview"
        lead={state.account.frozen ? "Spending is frozen. Nothing can be bought until you unfreeze."
          : `${plural(liveAgents, "agent")} can spend under ${plural(state.mandates.length, "active mandate")}.`} />
      {paypalNotice}
      <SetupChecklist />

      <Section title="Needs you" className="mb-8" hint={attention ? undefined : "Approvals and settlement offers appear here the moment they come in."}>
        {attention === 0 ? (
          <div className="card flex items-center gap-3 p-4 text-base text-ink-2"><CircleCheck size={18} className="shrink-0 text-ok" aria-hidden />Nothing is waiting on you.</div>
        ) : (
          <div className="space-y-3">
            {autoPaused.map((a) => (
              <Banner key={a.id} tone="warn" icon={<PauseCircle size={18} aria-hidden />} title={`The gateway paused “${a.name}”`}
                action={<Link href="/agents" className="btn btn-secondary btn-sm">Review agent</Link>}>
                It was {a.pauseReason}. Look at what it tried to buy before you resume it.
              </Banner>
            ))}
            {[...approvals, ...offers].map((p) => <PurchaseCard key={p.id} p={p} />)}
          </div>
        )}
      </Section>

      <section aria-label="Key numbers" className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat tone="ok" icon={<Wallet size={16} aria-hidden />} label="Spent by agents" value={money(stats.spentCents)} href="/activity?status=paid"
          note={`${plural(stats.paidCount, "purchase")}${stats.refundedCents ? `, after ${money(stats.refundedCents)} refunded` : ""}`} />
        <Stat tone="bad" icon={<Ban size={16} aria-hidden />} label="Blocked attempts" value={String(stats.blockedCount)} href="/activity?status=blocked"
          note={stats.blockedCount ? `${money(stats.blockedCents)} that was not spent` : "Nothing has been blocked"} />
        <Stat tone="flag" icon={<ShieldAlert size={16} aria-hidden />} label="Injection attempts" value={String(stats.injectionFlags)} href="/activity?flagged=1"
          note={stats.injectionFlags ? "Store pages with text aimed at AI agents" : "No page has tried to steer an agent"} />
        <Stat tone="warn" icon={<Hand size={16} aria-hidden />} label="Waiting on you" value={String(stats.pendingCount + stats.offersWaiting)} href="/activity?status=needs_you"
          note={`${plural(stats.pendingCount, "approval")}, ${plural(stats.offersWaiting, "offer")}`} />
      </section>

      <div className="mb-8 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Section title="Last 14 days">
          <div className="card p-4 sm:p-5"><ActivityChart days={stats.byDay} /></div>
        </Section>
        <Section title="Why purchases were blocked">
          <div className="card p-4 sm:p-5">
            {stats.blockReasons.length === 0 ? <p className="text-base text-ink-3">No purchase has been blocked. When one is, the rule that stopped it is counted here.</p> : (
              <ul className="space-y-3">
                {stats.blockReasons.slice(0, 7).map((r) => (
                  <li key={r.rule}>
                    <div className="flex items-baseline justify-between gap-3 text-base"><span className="text-ink">{checkFailed(r.rule)}</span><span className="num font-semibold text-ink">{r.count}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-sunken"><div className="h-1.5 rounded-full bg-bad" style={{ width: `${(r.count / maxReason) * 100}%` }} /></div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Section title="Budgets" actions={<Link href="/mandates" className="link text-sm">All mandates</Link>}>
          {state.mandates.length === 0 ? (
            <EmptyState title="No active mandate" action={<Link href="/mandates?new=1" className="btn btn-primary">Write a mandate</Link>}>Without one, every purchase request is blocked.</EmptyState>
          ) : (
            <div className="card divide-y divide-line">
              {state.mandates.map((m) => (
                <div key={m.id} className="space-y-3 p-4 sm:p-5">
                  <Meter label={m.name ?? m.rules.summary} usedCents={m.spentCents} limitCents={m.rules.totalLimitCents} currency={m.rules.currency} />
                  {m.rules.dailyLimitCents != null && <Meter label="Today" usedCents={m.todayCents} limitCents={m.rules.dailyLimitCents} currency={m.rules.currency} />}
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section title="Recent activity" actions={<Link href="/activity" className="link inline-flex items-center gap-1 text-sm">All activity<ArrowRight size={13} aria-hidden /></Link>}>
          {state.purchases.length === 0 ? (
            <EmptyState title="No purchases yet">Once a connected agent asks to buy something, it shows up here within seconds, whether it was paid or blocked.</EmptyState>
          ) : (
            <div className="space-y-3">{state.purchases.slice(0, 5).map((p) => <PurchaseCard key={p.id} p={p} compact />)}</div>
          )}
        </Section>
      </div>
    </>
  );
}
