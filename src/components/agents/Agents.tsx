"use client";
import { Bot, Pause, PauseCircle, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { createAgentAction, pauseAgentAction, resumeAgentAction, revokeAgentAction, rotateAgentKeyAction } from "@/app/actions";
import type { AgentView } from "@/lib/views";
import { useAccount } from "../AccountProvider";
import { isAutoPause, money, type Tone } from "../format";
import LocalTime from "../LocalTime";
import { Badge } from "../ui/Badge";
import Banner, { ErrorText } from "../ui/Banner";
import Button from "../ui/Button";
import ConfirmButton from "../ui/ConfirmButton";
import { EmptyState, Fact, PageHeader, Section } from "../ui/Layout";
import { useAction } from "../useAction";
import KeyReveal from "./KeyReveal";

type Reveal = { name: string; key: string; rotated: boolean };
const STATUS: Record<AgentView["status"], { label: string; tone: Tone }> = { active: { label: "Active", tone: "ok" }, paused: { label: "Paused", tone: "warn" }, revoked: { label: "Revoked", tone: "neutral" } };

function AgentCard({ a, onKey }: { a: AgentView; onKey: (r: Reveal) => void }) {
  const { state } = useAccount();
  const pause = useAction(pauseAgentAction), resume = useAction(resumeAgentAction), revoke = useAction(revokeAgentAction), rotate = useAction(rotateAgentKeyAction);
  const busy = pause.pending || resume.pending || revoke.pending || rotate.pending;
  const error = pause.error ?? resume.error ?? revoke.error ?? rotate.error;
  const mandates = state.mandates.filter((m) => !m.agentIds || m.agentIds.includes(a.id));
  const auto = a.status === "paused" && isAutoPause(a.pauseReason);
  const s = STATUS[a.status];

  return (
    <article className={`card p-5 sm:p-6 ${a.status === "revoked" ? "bg-raised" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-2"><Bot size={19} aria-hidden /></span>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">{a.name}</h3>
            <p className="text-sm text-ink-3">{a.builtIn ? <Link href="/assistant" className="link">Built into this dashboard</Link> : <span className="code">{a.keyPrefix}…</span>} · {a.lastSeenAt ? <>last seen <LocalTime iso={a.lastSeenAt} format="relative" /></> : "has not connected yet"}</p>
          </div>
        </div>
        <Badge tone={s.tone} icon={<span className="tone-fill inline-block size-1.5 rounded-full" aria-hidden />}>{s.label}</Badge>
      </div>

      {auto && (
        <Banner tone="warn" role="alert" className="mt-4" icon={<PauseCircle size={18} aria-hidden />} title="The gateway paused this agent"
          action={<Link href={`/activity?agent=${a.id}&status=blocked`} className="btn btn-secondary btn-sm">See what it tried</Link>}>
          It was {a.pauseReason}. A run of blocked attempts is how a hijacked or confused agent looks, so nothing it asks for is paid until you resume it.
        </Banner>
      )}
      {a.status === "paused" && !auto && <Banner tone="neutral" className="mt-4" icon={<Pause size={16} aria-hidden />}>You paused this agent. Every purchase it asks for is blocked until you resume it.</Banner>}

      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Fact label="Requests"><span className="num">{a.stats.requests}</span></Fact>
        <Fact label="Paid"><span className="num">{a.stats.paid}</span></Fact>
        <Fact label="Blocked"><span className="num">{a.stats.blocked}</span></Fact>
        <Fact label="Spent"><span className="num">{money(a.stats.spentCents)}</span></Fact>
      </dl>
      <p className="mt-3 text-sm text-ink-3">
        {a.status === "revoked" ? "Its key no longer works." : mandates.length ? <>Can spend under: {mandates.map((m) => m.name ?? "Untitled mandate").join(", ")}.</> : <>No mandate covers this agent, so everything it asks for is blocked. <Link href="/mandates?new=1" className="link">Write one</Link>.</>}
        {" "}Connected <LocalTime iso={a.createdAt} format="date" />.
      </p>

      {a.status !== "revoked" && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {a.status === "paused"
            ? <Button size="sm" variant={auto ? "primary" : "secondary"} icon={<Play size={13} aria-hidden />} loading={resume.pending} disabled={busy} onClick={() => resume.run(a.id)}>Resume</Button>
            : <Button size="sm" icon={<Pause size={13} aria-hidden />} loading={pause.pending} disabled={busy} onClick={() => pause.run(a.id)}>Pause</Button>}
          <Link href={`/activity?agent=${a.id}`} className="btn btn-secondary btn-sm">Its activity</Link>
          {!a.builtIn && <ConfirmButton variant="secondary" question="The current key stops working at once. Rotate?" confirmLabel="Rotate key" loading={rotate.pending} icon={<RefreshCw size={13} aria-hidden />}
            onConfirm={async () => { const r = await rotate.run(a.id); if (r) onKey({ name: a.name, key: r.key, rotated: true }); }}>Rotate key</ConfirmButton>}
          <ConfirmButton question="Revoke for good? This cannot be undone." confirmLabel="Revoke" loading={revoke.pending} icon={<Trash2 size={13} aria-hidden />} onConfirm={() => revoke.run(a.id)}>Revoke</ConfirmButton>
        </div>
      )}
      {error && <div className="mt-2"><ErrorText>{error}</ErrorText></div>}
    </article>
  );
}

/** Connect agents, see what each one has done, and pause, rotate or revoke them. */
export default function Agents({ startNew }: { startNew: boolean }) {
  const { state } = useAccount();
  const create = useAction(createAgentAction);
  const [adding, setAdding] = useState(startNew);
  const [name, setName] = useState("");
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const live = state.agents.filter((a) => a.status !== "revoked"), revoked = state.agents.filter((a) => a.status === "revoked");
  const showKey = (r: Reveal) => { setReveal(r); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim() || "My agent";
    const r = await create.run(n);
    if (r) { showKey({ name: n, key: r.key, rotated: false }); setAdding(false); setName(""); }
  };

  return (
    <>
      <PageHeader title="Agents" lead="Each agent gets its own key to the gateway. A key lets an agent ask for a purchase; it never gives access to your PayPal account."
        actions={!adding && !reveal && <Button variant="primary" icon={<Plus size={15} aria-hidden />} onClick={() => setAdding(true)}>Connect an agent</Button>} />

      {reveal && <KeyReveal agentName={reveal.name} agentKey={reveal.key} rotated={reveal.rotated} appUrl={state.appUrl} onDone={() => setReveal(null)} />}

      {adding && !reveal && (
        <form onSubmit={add} className="card rise mb-8 border-brand p-5 shadow-card sm:p-6">
          <p className="eyebrow">New agent</p>
          <h2 className="display mt-1 text-xl text-ink sm:text-2xl">Which agent is this key for?</h2>
          <div className="mt-4 max-w-md">
            <label htmlFor="agent-name" className="field-label">Name</label>
            <input id="agent-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Claude Desktop on my laptop" autoFocus disabled={create.pending} />
            <p className="field-hint">Only you see this. It is shown next to everything the agent asks to buy.</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={create.pending} loadingText="Creating key">Create key</Button>
            <Button variant="quiet" disabled={create.pending} onClick={() => setAdding(false)}>Cancel</Button>
          </div>
          {create.error && <div className="mt-3"><ErrorText>{create.error}</ErrorText></div>}
        </form>
      )}

      <Section title="Connected" className="mb-8">
        {live.length === 0 ? (
          <EmptyState icon={<Bot size={18} aria-hidden />} title="No agent is connected"
            action={!adding && !reveal && <Button variant="primary" icon={<Plus size={15} aria-hidden />} onClick={() => setAdding(true)}>Connect your first agent</Button>}>
            Works with Claude Desktop and any other MCP client, or with any framework over REST. See the <Link href="/developers" className="link">developer page</Link> for what an agent can call.
          </EmptyState>
        ) : (
          <div className="space-y-4">{live.map((a) => <AgentCard key={a.id} a={a} onKey={showKey} />)}</div>
        )}
      </Section>

      {revoked.length > 0 && (
        <Section title="Revoked" hint="Their keys no longer work. Their history stays in your activity.">
          <div className="space-y-4">{revoked.map((a) => <AgentCard key={a.id} a={a} onKey={showKey} />)}</div>
        </Section>
      )}
    </>
  );
}
