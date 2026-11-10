"use client";
import { Bot, CircleCheck, Plus, Replace, ScrollText, Trash2 } from "lucide-react";
import { useState } from "react";
import { revokeMandateAction } from "@/app/actions";
import type { MandateView } from "@/lib/views";
import { useAccount } from "../AccountProvider";
import { plural } from "../format";
import LocalTime from "../LocalTime";
import { Badge } from "../ui/Badge";
import Banner, { ErrorText } from "../ui/Banner";
import Button from "../ui/Button";
import ConfirmButton from "../ui/ConfirmButton";
import { EmptyState, PageHeader, Section } from "../ui/Layout";
import Meter from "../ui/Meter";
import { useAction } from "../useAction";
import MandateComposer from "./MandateComposer";
import RulesList from "./RulesList";

function MandateCard({ m, onReplace }: { m: MandateView; onReplace: () => void }) {
  const revoke = useAction(revokeMandateAction);
  return (
    <article className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="display text-xl text-ink [overflow-wrap:anywhere]">{m.name ?? "Untitled mandate"}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {m.expired ? <Badge tone="bad">Expired</Badge> : <Badge tone="ok" icon={<span className="tone-fill inline-block size-1.5 rounded-full" aria-hidden />}>In force</Badge>}
            <Badge tone="neutral" icon={<Bot size={12} aria-hidden />}>{m.agentNames ? (m.agentNames.length ? m.agentNames.join(", ") : "No current agent") : "All agents"}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={<Replace size={13} aria-hidden />} onClick={onReplace} disabled={revoke.pending}>Replace</Button>
          <ConfirmButton question="Revoke this mandate?" confirmLabel="Revoke" loading={revoke.pending} icon={<Trash2 size={13} aria-hidden />} onConfirm={() => revoke.run(m.id)}>Revoke</ConfirmButton>
        </div>
      </div>
      {revoke.error && <div className="mt-2"><ErrorText>{revoke.error}</ErrorText></div>}

      <blockquote className="quote mt-4 border-l-2 border-line-strong pl-4 italic [overflow-wrap:anywhere]">“{m.sourceText}”</blockquote>
      {m.expired && <Banner tone="bad" className="mt-4">This mandate has passed its end date, so purchases under it are blocked. Replace it to keep your agents shopping.</Banner>}

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Meter label="Total budget" usedCents={m.spentCents} limitCents={m.rules.totalLimitCents} currency={m.rules.currency} />
        {m.rules.dailyLimitCents != null
          ? <Meter label="Today" usedCents={m.todayCents} limitCents={m.rules.dailyLimitCents} currency={m.rules.currency} />
          : <p className="self-center text-sm text-ink-3">{plural(m.purchaseCount, "purchase")} so far{m.rules.maxPurchases !== null ? ` of ${m.rules.maxPurchases} allowed` : ""}. Committed money includes purchases waiting for your approval; refunds go back into the budget.</p>}
      </div>

      <details className="group mt-5 border-t border-line pt-3" open>
        <summary className="text-sm font-semibold text-ink-2 hover:text-ink">The rules the gateway enforces</summary>
        <div className="mt-1"><RulesList rules={m.rules} /></div>
        {m.confirmedAt && <p className="mt-2 text-xs text-ink-3">Confirmed <LocalTime iso={m.confirmedAt} /> · <span className="code">{m.id}</span></p>}
      </details>
    </article>
  );
}

/** Active mandates with their budgets and rules, the composer for a new one, and the history. */
export default function Mandates({ startNew }: { startNew: boolean }) {
  const { state } = useAccount();
  const [composer, setComposer] = useState<{ replace: MandateView | null } | null>(startNew ? { replace: null } : null);
  const [confirmed, setConfirmed] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Mandates" lead="A mandate is your standing instruction: what an agent may buy, how much it may spend, and when to ask you first. Several can be in force at once; a purchase goes ahead under the first one that allows it."
        actions={!composer && <Button variant="primary" icon={<Plus size={15} aria-hidden />} onClick={() => { setComposer({ replace: null }); setConfirmed(null); }}>New mandate</Button>} />

      {confirmed !== null && <Banner tone="ok" role="status" className="mb-5" icon={<CircleCheck size={17} aria-hidden />} title="Mandate confirmed">{confirmed ? `“${confirmed}” is` : "It is"} in force now. It was written to the signed ledger.</Banner>}
      {composer && <MandateComposer key={composer.replace?.id ?? "new"} replace={composer.replace} onClose={() => setComposer(null)} onConfirmed={(name) => { setComposer(null); setConfirmed(name ?? ""); }} />}

      <Section title="In force" className="mb-8">
        {state.mandates.length === 0 ? (
          <EmptyState icon={<ScrollText size={18} aria-hidden />} title="No mandate is in force"
            action={!composer && <Button variant="primary" icon={<Plus size={15} aria-hidden />} onClick={() => setComposer({ replace: null })}>Write your first mandate</Button>}>
            Until you confirm one, the gateway blocks every purchase an agent asks for.
          </EmptyState>
        ) : (
          <div className="space-y-4">{state.mandates.map((m) => <MandateCard key={m.id} m={m} onReplace={() => { setComposer({ replace: m }); setConfirmed(null); window.scrollTo({ top: 0, behavior: "smooth" }); }} />)}</div>
        )}
      </Section>

      {state.pastMandates.length > 0 && (
        <Section title="Past mandates" hint="Revoked or replaced. They can no longer be used; the ten most recent are kept here for reference.">
          <ul className="card divide-y divide-line">
            {state.pastMandates.map((m) => (
              <li key={m.id} className="p-4 sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="font-semibold text-ink">{m.name ?? "Untitled mandate"} <Badge tone="neutral" className="ml-1 capitalize">{m.status}</Badge></p>
                  {m.confirmedAt && <p className="text-xs text-ink-3">Confirmed <LocalTime iso={m.confirmedAt} format="date" /></p>}
                </div>
                <p className="mt-1 text-base italic text-ink-2 [overflow-wrap:anywhere]">“{m.sourceText}”</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
