"use client";
import { ArrowLeft, PenLine, Sparkles, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { compileMandateAction, confirmMandateAction } from "@/app/actions";
import type { MandateQuestion } from "@/lib/mandate-check";
import type { MandateExample } from "@/lib/mandate-examples";
import type { MandateRules } from "@/lib/rules";
import type { MandateView } from "@/lib/views";
import { useAccount } from "../AccountProvider";
import Banner, { ErrorText } from "../ui/Banner";
import Button from "../ui/Button";
import { useAction } from "../useAction";
import MandateBuilder from "./MandateBuilder";
import RulesList from "./RulesList";

const EXAMPLES = [
  "Up to $150 on running shoes from verified stores. Ask me before anything over $100.",
  "Up to $200 on running gear, at most $120 per purchase and $120 a day, for the next 3 days.",
  "Up to $120 on running shoes at any store the gateway can pay. Never buy from Kickz Outlet.",
];

/**
 * Writing a mandate is two steps: describe it in plain English, then read the exact rules a model compiled
 * from it and confirm them. Nothing takes effect until the second step, and after that only code enforces it.
 */
export default function MandateComposer({ replace, onClose, onConfirmed }: { replace?: MandateView | null; onClose: () => void; onConfirmed: (name: string | null) => void }) {
  const { state } = useAccount();
  const compile = useAction(compileMandateAction), confirm = useAction(confirmMandateAction);
  const [text, setText] = useState(replace?.sourceText ?? "");
  const [draft, setDraft] = useState<{ rules: MandateRules; warnings: string[]; questions: MandateQuestion[]; examples: MandateExample[] } | null>(null);
  // Writing is the default: the sentence is what gets compiled, checked and signed. The builder is one tab away.
  const [mode, setMode] = useState<"build" | "write">("write");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [name, setName] = useState(replace?.name ?? "");
  const [scoped, setScoped] = useState(!!replace?.agentIds?.length);
  const [agentIds, setAgentIds] = useState<string[]>(replace?.agentIds ?? []);
  const agents = state.agents.filter((a) => a.status !== "revoked");

  const toRules = async (e: React.FormEvent) => { e.preventDefault(); const r = await compile.run(text); if (r) { setDraft({ rules: r.rules, warnings: r.warnings, questions: r.questions, examples: r.examples }); setAnswers({}); } };
  // Answers become part of the mandate's own words, so the signed record shows exactly what the user said.
  const answer = async () => {
    const extra = (draft?.questions ?? []).map((q) => answers[q.id]?.trim()).filter(Boolean).join(" ");
    if (!extra) return;
    const next = `${text.trim()} ${extra}`.slice(0, 2000);
    setText(next);
    const r = await compile.run(next);
    if (r) { setDraft({ rules: r.rules, warnings: r.warnings, questions: r.questions, examples: r.examples }); setAnswers({}); }
  };
  const mustAnswer = (draft?.questions ?? []).some((q) => q.required);
  const save = async () => {
    if (!draft) return;
    const r = await confirm.run(text, draft.rules, { name: name.trim() || undefined, agentIds: scoped && agentIds.length ? agentIds : null, replaceId: replace?.id });
    if (r) onConfirmed(name.trim() || null);
  };
  const toggle = (id: string) => setAgentIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  return (
    <section className="card rise mb-8 border-brand p-5 shadow-card sm:p-6" aria-label={replace ? "Replace mandate" : "New mandate"}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{replace ? `Replacing “${replace.name ?? "Untitled mandate"}”` : "New mandate"} · Step {draft ? 2 : 1} of 2</p>
          <h2 className="display mt-1 text-xl text-ink sm:text-2xl">{draft ? "Check the rules, then confirm" : "What may your agent buy?"}</h2>
        </div>
        <button type="button" className="btn btn-quiet btn-sm !px-2" onClick={onClose} aria-label="Close"><X size={16} aria-hidden /></button>
      </div>

      {!draft ? (
        <form onSubmit={toRules}>
          {!state.llm && <Banner tone="warn" className="mb-4" icon={<TriangleAlert size={17} aria-hidden />} title="No model is configured on this gateway">Turning text into rules needs one, so this step may fail.</Banner>}
          <div role="tablist" aria-label="How to write the mandate" className="mb-5 inline-flex rounded-lg border border-line bg-raised p-1">
            {([["write", "Write it myself"], ["build", "Pick from choices"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={mode === id} disabled={compile.pending} onClick={() => setMode(id)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${mode === id ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}>{label}</button>
            ))}
          </div>
          {mode === "build" ? (
            <div>
              <p className="mb-5 max-w-2xl text-base text-ink-2">A mandate is a spending allowance with rules. Your agent can buy inside it without asking; anything outside it is blocked or comes to you first.</p>
              <MandateBuilder onChange={setText} disabled={compile.pending} />
              <figure className="mt-6 rounded-[10px] border border-line bg-raised p-4">
                <figcaption className="eyebrow">Your mandate, in words</figcaption>
                <blockquote className="quote mt-1 italic [overflow-wrap:anywhere]">“{text}”</blockquote>
                <button type="button" className="link mt-2 text-sm" onClick={() => setMode("write")}>Edit the wording</button>
              </figure>
            </div>
          ) : (
            <div>
          <label htmlFor="mandate-text" className="field-label">Say it in your own words</label>
            <textarea id="mandate-text" className="field quote !leading-7" rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} disabled={compile.pending} autoFocus
              placeholder="Up to $150 on running shoes from verified stores. Ask me before anything over $100." />
            <p className="field-hint">Mention a total budget and what may be bought. You can also give a per-purchase or daily limit, an amount above which to ask you, which stores, and when it ends. With no end date it lasts 7 days.</p>
            <div className="mt-3">
              <p className="eyebrow mb-1.5">Or start from an example</p>
              <div className="flex flex-col gap-1.5">
                {EXAMPLES.map((x) => <button key={x} type="button" disabled={compile.pending} onClick={() => setText(x)} className="rounded-lg border border-line bg-raised px-3 py-2 text-left text-sm text-ink-2 transition-colors hover:border-line-strong hover:text-ink">{x}</button>)}
              </div>
            </div>
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" icon={<Sparkles size={15} aria-hidden />} loading={compile.pending} loadingText="Reading your mandate" disabled={text.trim().length < 8}>Turn into rules</Button>
            {compile.pending && <span className="text-sm text-ink-3" role="status">A model is turning your words into exact rules. This takes a few seconds.</span>}
          </div>
          {compile.error && <div className="mt-3"><ErrorText>{compile.error}</ErrorText></div>}
        </form>
      ) : (
        <div>
          <figure className="rounded-[10px] border border-line bg-raised p-4">
            <figcaption className="eyebrow">You wrote</figcaption>
            <blockquote className="quote mt-1 italic [overflow-wrap:anywhere]">“{text}”</blockquote>
          </figure>
          <p className="mt-4 text-base text-ink-2"><span className="font-semibold text-ink">The gateway understood:</span> {draft.rules.summary}</p>
          {draft.questions.length > 0 && (
            <div className="mt-4 rounded-[10px] border border-warn bg-warn-soft p-4">
              <p className="font-semibold text-warn-ink">{mustAnswer ? "The gateway needs an answer before this can be confirmed" : "Your wording left something open"}</p>
              {!mustAnswer && <p className="mt-0.5 text-sm text-ink-2">The rules below use the narrower reading. Answer to change them, or confirm them as they are.</p>}
              <div className="mt-3 space-y-3">
                {draft.questions.map((q) => (
                  <div key={q.id}>
                    <label htmlFor={`q-${q.id}`} className="field-label">{q.question}{q.required && <span className="font-normal text-warn-ink"> (required)</span>}</label>
                    <input id={`q-${q.id}`} className="field" value={answers[q.id] ?? ""} maxLength={200} placeholder={q.hint} disabled={compile.pending}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); answer(); } }} />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="primary" size="sm" loading={compile.pending} loadingText="Updating the rules" disabled={!Object.values(answers).some((v) => v.trim())} onClick={answer}>Update the rules</Button>
                {compile.error && <ErrorText>{compile.error}</ErrorText>}
              </div>
            </div>
          )}
          {draft.warnings.map((w) => <Banner key={w} tone="warn" className="mt-3" icon={<TriangleAlert size={17} aria-hidden />}>{w}</Banner>)}
          <div className="mt-3"><RulesList rules={draft.rules} /></div>
          {draft.examples.length > 0 && (
            <div className="mt-5">
              <p className="eyebrow">What this means in practice</p>
              <ul className="mt-2 divide-y divide-line rounded-[10px] border border-line">
                {draft.examples.map((x) => {
                  const o = x.outcome === "approve" ? { label: "Paid without asking", tone: "ok" } : x.outcome === "needs_approval" ? { label: "Asks you first", tone: "warn" } : { label: "Blocked", tone: "bad" };
                  return (
                    <li key={x.purchase} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3.5 py-2.5">
                      <span className="min-w-0 text-base text-ink [overflow-wrap:anywhere]">If your agent tries to buy {x.purchase}</span>
                      <span className={`tone-${o.tone} tone-softbg tone-text shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold`}>{o.label}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1.5 text-sm text-ink-3">These are made-up purchases run through the same checks the gateway uses on real ones.</p>
            </div>
          )}
          <p className="mt-2 text-sm text-ink-3">If a rule is not what you meant, change your wording and try again. These exact rules, not the sentence, are what gets enforced.</p>

          <div className="mt-5 grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
            <div>
              <label htmlFor="mandate-name" className="field-label">Name <span className="font-normal text-ink-3">(optional)</span></label>
              <input id="mandate-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Running shoes" disabled={confirm.pending} />
              <p className="field-hint">Shown next to each purchase made under this mandate.</p>
            </div>
            <fieldset disabled={confirm.pending}>
              <legend className="field-label">Which agents may use it?</legend>
              <label className="flex items-center gap-2 py-1 text-base"><input type="radio" name="scope" checked={!scoped} onChange={() => setScoped(false)} />All my agents, including ones I connect later</label>
              <label className={`flex items-center gap-2 py-1 text-base ${agents.length ? "" : "text-ink-3"}`}><input type="radio" name="scope" checked={scoped} disabled={!agents.length} onChange={() => setScoped(true)} />Only the agents I pick{!agents.length && " (none connected yet)"}</label>
              {scoped && (
                <div className="ml-6 mt-1 space-y-1">
                  {agents.map((a) => <label key={a.id} className="flex items-center gap-2 text-base"><input type="checkbox" checked={agentIds.includes(a.id)} onChange={() => toggle(a.id)} />{a.name}</label>)}
                  {agentIds.length === 0 && <p className="text-xs text-warn-ink">Pick at least one agent.</p>}
                </div>
              )}
            </fieldset>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<PenLine size={15} aria-hidden />} loading={confirm.pending} loadingText="Confirming" disabled={mustAnswer || (scoped && agentIds.length === 0)} onClick={save}>{replace ? "Confirm and replace" : "Confirm mandate"}</Button>
            <Button variant="quiet" icon={<ArrowLeft size={15} aria-hidden />} disabled={confirm.pending} onClick={() => { setDraft(null); confirm.clearError(); }}>Change the wording</Button>
          </div>
          {replace && <p className="mt-2 text-sm text-ink-3">The current mandate is revoked the moment this one is confirmed. Money already spent under it does not carry over.</p>}
          {confirm.error && <div className="mt-3"><ErrorText>{confirm.error}</ErrorText></div>}
        </div>
      )}
    </section>
  );
}
