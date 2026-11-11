"use client";
import { ArrowUp, Ban, Check, CircleAlert, Clock, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { restartAssistantAction } from "@/app/actions";
import type { AssistantEvent } from "@/lib/assistant";
import { useAccount } from "../AccountProvider";
import DemoWalletButton from "../DemoWalletButton";
import Banner from "../ui/Banner";
import Button from "../ui/Button";
import { PageHeader } from "../ui/Layout";
import { useAction } from "../useAction";

type Step = { id: string; label: string; summary?: string; tone?: "ok" | "warn" | "bad" | "neutral"; purchaseId?: string; approvalUrl?: string };
type Msg = { role: "user"; text: string } | { role: "assistant"; text: string; steps: Step[]; error?: string };

const STORE_KEY = "mandate.assistant.chat";
const IDEAS = [
  { label: "Buy something allowed", text: "Buy me road running shoes under $100 from Stride." },
  { label: "Try a page with a hidden instruction", text: "Buy the Cloudline Daily Trainer from Stride." },
  { label: "Try an unverified store", text: "Find the cheapest running shoes at Kickz Outlet and buy them." },
  { label: "Check what is allowed", text: "What am I allowing you to buy, and how much is left?" },
];

function StepRow({ s }: { s: Step }) {
  const icon = !s.summary ? <LoaderCircle size={14} className="spin" aria-hidden />
    : s.tone === "ok" ? <Check size={14} aria-hidden /> : s.tone === "bad" ? <Ban size={14} aria-hidden /> : s.tone === "warn" ? <Clock size={14} aria-hidden /> : <Check size={14} aria-hidden />;
  return (
    <li className={`tone-${s.summary ? s.tone ?? "neutral" : "neutral"} flex flex-wrap items-start gap-x-2 gap-y-1 text-sm`}>
      <span className={`mt-0.5 shrink-0 ${s.summary && s.tone !== "neutral" ? "tone-text" : "text-ink-3"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="text-ink-3">{s.label}</span>
        {s.summary && <span className={`block font-medium ${s.tone === "neutral" ? "text-ink-2" : "tone-text"}`}>{s.summary}</span>}
      </span>
      {s.purchaseId && (
        <span className="flex shrink-0 flex-wrap gap-1.5">
          {s.approvalUrl && <a href={s.approvalUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">Approve or decline</a>}
          <Link href={`/purchases/${s.purchaseId}`} className="btn btn-secondary btn-sm">Open the record</Link>
        </span>
      )}
    </li>
  );
}

/** The built-in shopping assistant: a chat that buys through the gateway like any connected agent. */
export default function Chat() {
  const { state, refresh } = useAccount();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(state.assistant.remaining);
  const end = useRef<HTMLDivElement>(null);
  const restart = useAction(restartAssistantAction);

  // The conversation survives moving between pages, for this browser tab only.
  useEffect(() => { try { const s = sessionStorage.getItem(STORE_KEY); if (s) setMsgs(JSON.parse(s)); } catch { /* no storage */ } }, []);
  useEffect(() => { if (!busy) try { sessionStorage.setItem(STORE_KEY, JSON.stringify(msgs)); } catch { /* no storage */ } }, [msgs, busy]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [msgs]);
  useEffect(() => { if (!busy) setLeft(state.assistant.remaining); }, [state.assistant.remaining, busy]);

  const builtIn = state.agents.filter((a) => a.builtIn);
  const revoked = builtIn.length > 0 && builtIn[0].status === "revoked";
  const paused = builtIn[0]?.status === "paused";

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    const history = [...msgs, { role: "user" as const, text: t }];
    setMsgs([...history, { role: "assistant", text: "", steps: [] }]);
    setDraft(""); setBusy(true);
    const patch = (f: (m: Extract<Msg, { role: "assistant" }>) => void) => setMsgs((all) => {
      const last = all[all.length - 1];
      if (last?.role !== "assistant") return all;
      const copy = { ...last, steps: last.steps.map((s) => ({ ...s })) };
      f(copy);
      return [...all.slice(0, -1), copy];
    });
    const apply = (e: AssistantEvent) => {
      if (e.type === "text") patch((m) => { m.text += e.delta; });
      else if (e.type === "step") patch((m) => { if (m.text && !m.text.endsWith("\n")) m.text += "\n\n"; m.steps.push({ id: e.id, label: e.label }); });
      else if (e.type === "step_done") { patch((m) => { const s = m.steps.find((x) => x.id === e.id); if (s) Object.assign(s, { summary: e.summary, tone: e.tone, purchaseId: e.purchaseId, approvalUrl: e.approvalUrl }); }); refresh(); }
      else if (e.type === "error") patch((m) => { m.error = e.message; });
      else if (e.type === "done") setLeft(e.remaining);
    };
    try {
      // What the model is sent: the words of the conversation, plus the purchase ids so a follow-up can refer to them.
      const wire = history.map((m) => ({ role: m.role, text: m.role === "user" ? m.text : [m.text, ...m.steps.filter((s) => s.purchaseId).map((s) => `(${s.summary}; purchase id ${s.purchaseId})`)].filter(Boolean).join("\n") }));
      const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: wire }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? "The assistant could not be reached.");
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) apply(JSON.parse(line) as AssistantEvent);
      }
    } catch (e) {
      patch((m) => { m.error = e instanceof Error ? e.message : "The assistant could not be reached."; });
    } finally {
      patch((m) => { for (const s of m.steps) if (!s.summary) { s.summary = "Did not finish"; s.tone = "bad"; } });
      setBusy(false); refresh();
    }
  }, [busy, msgs, refresh]);

  const blocked = revoked || !state.llm || left <= 0;
  return (
    <>
      <PageHeader title="Shopping assistant"
        lead="An agent built into this dashboard. It shops at the demo stores and buys through the gateway, held to your mandates exactly like an agent you connect yourself."
        actions={msgs.length > 0 && <Button size="sm" icon={<RotateCcw size={13} aria-hidden />} disabled={busy} onClick={() => setMsgs([])}>New chat</Button>} />

      <div className="mb-4 space-y-3 empty:hidden">
        {!state.paypal && <Banner tone="warn" icon={<CircleAlert size={17} aria-hidden />} title="PayPal is not linked" action={<span className="flex flex-wrap gap-2"><a href="/api/paypal/link" className="btn btn-primary btn-sm">Link PayPal</a><DemoWalletButton size="sm" /></span>}>The assistant can look around, but every purchase is blocked until a wallet is linked.</Banner>}
        {state.paypal && state.mandates.length === 0 && <Banner tone="warn" icon={<CircleAlert size={17} aria-hidden />} title="No mandate is active" action={<Link href="/mandates?new=1" className="btn btn-primary btn-sm">Write a mandate</Link>}>Without a mandate the gateway blocks everything the assistant asks for.</Banner>}
        {paused && <Banner tone="warn" icon={<CircleAlert size={17} aria-hidden />} title="The assistant is paused" action={<Link href="/agents" className="btn btn-secondary btn-sm">Agents</Link>}>It can still talk, but the gateway blocks its purchases until you resume it.</Banner>}
        {revoked && <Banner tone="neutral" title="You revoked the assistant" action={<Button size="sm" variant="primary" loading={restart.pending} onClick={() => restart.run()}>Start a new one</Button>}>A new assistant appears on the Agents page as a new agent.</Banner>}
        {!state.llm && <Banner tone="neutral" title="No model key on this deployment">The assistant needs ANTHROPIC_API_KEY to run.</Banner>}
      </div>

      <div className="card flex min-h-[26rem] flex-col">
        <div className="flex-1 space-y-5 p-4 sm:p-6" aria-live="polite">
          {msgs.length === 0 && (
            <div className="mx-auto max-w-xl py-6 text-center">
              <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand-ink"><Sparkles size={20} aria-hidden /></span>
              <p className="display text-xl text-ink">Ask it to buy something</p>
              <p className="mt-1 text-base text-ink-2">Every purchase it asks for is checked against your mandate. You will see what it did, and whether the gateway paid, asked you, or blocked it.</p>
              <ul className="mt-5 grid gap-2 text-left sm:grid-cols-2">
                {IDEAS.map((i) => (
                  <li key={i.label}>
                    <button type="button" disabled={blocked || busy} onClick={() => send(i.text)} className="h-full w-full rounded-lg border border-line bg-raised px-3.5 py-3 text-left transition-colors hover:border-line-strong hover:bg-sunken disabled:opacity-55">
                      <span className="block text-sm font-semibold text-ink">{i.label}</span>
                      <span className="block text-sm text-ink-3">{i.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {msgs.map((m, i) => m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-base text-on-brand [overflow-wrap:anywhere]">{m.text}</p>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink"><Sparkles size={15} aria-hidden /></span>
              <div className="min-w-0 flex-1 space-y-3">
                {m.steps.length > 0 && <ul className="space-y-2 rounded-lg border border-line bg-raised px-3.5 py-3">{m.steps.map((s) => <StepRow key={s.id} s={s} />)}</ul>}
                {m.text && <p className="whitespace-pre-wrap text-base text-ink [overflow-wrap:anywhere]">{m.text.trim()}</p>}
                {!m.text && !m.steps.length && !m.error && <p className="flex items-center gap-2 text-sm text-ink-3"><LoaderCircle size={14} className="spin" aria-hidden />Thinking</p>}
                {m.error && <p role="alert" className="tone-bad tone-text text-sm font-medium">{m.error}</p>}
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>

        <form className="border-t border-line p-3 sm:p-4" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
          <div className="flex items-end gap-2">
            <label htmlFor="assistant-input" className="sr-only">Message the shopping assistant</label>
            <textarea id="assistant-input" className="field min-h-[2.75rem] flex-1 !resize-none text-base" rows={1} maxLength={1000} placeholder="Buy me running shoes under $100" value={draft} disabled={blocked}
              onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }} />
            <Button type="submit" variant="primary" size="lg" loading={busy} disabled={blocked || !draft.trim()} icon={<ArrowUp size={16} aria-hidden />} aria-label="Send">Send</Button>
          </div>
          <p className="mt-2 text-xs text-ink-3">
            {left > 0 ? <><span className="num">{left}</span> of <span className="num">{state.assistant.dailyLimit}</span> messages left today.</> : <>Today&apos;s {state.assistant.dailyLimit} messages are used; the limit resets at midnight UTC.</>}
            {" "}It runs as the agent &ldquo;Mandate shopping assistant&rdquo;, which you can pause or revoke on the <Link href="/agents" className="link">Agents</Link> page.
          </p>
        </form>
      </div>
    </>
  );
}
