"use client";
import { ArrowRight, Bot, Check, FileSignature, PenLine, ScrollText, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { compileMandateAction, confirmMandateAction } from "@/app/actions";
import type { DashboardState } from "@/lib/views";
import { useAccount } from "../AccountProvider";
import Chat from "../assistant/Chat";
import DemoWalletButton from "../DemoWalletButton";
import { money } from "../format";
import MandateComposer from "../mandates/MandateComposer";
import RulesList from "../mandates/RulesList";
import PurchaseCard from "../purchases/PurchaseCard";
import Banner, { ErrorText } from "../ui/Banner";
import Button from "../ui/Button";
import { useAction } from "../useAction";

/** A mandate a visitor can take as it is. It stays under the demo wallet's cap and makes the first purchase ask first. */
const STARTER = "Up to $100 on running shoes from verified stores. Ask me before anything over $60.";

/**
 * True while an account has never had an agent ask for anything and is still missing a wallet, a mandate
 * or an agent of its own. Such an account gets the guided first run in place of the overview.
 */
export function needsFirstRun(state: DashboardState) {
  if (state.purchases.length > 0) return false;
  const ownAgent = state.agents.some((a) => !a.builtIn && a.status !== "revoked");
  return !state.paypal || state.mandates.length === 0 || !ownAgent;
}

type Phase = "done" | "now" | "later";

function Step({ n, phase, title, summary, children }: { n: number; phase: Phase; title: string; summary: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li aria-current={phase === "now" ? "step" : undefined}>
      <div className="flex items-start gap-3">
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${phase === "done" ? "bg-ok-soft text-ok-ink" : phase === "now" ? "bg-brand text-on-brand" : "border border-line-strong text-ink-3"}`}>
          {phase === "done" ? <Check size={17} aria-label="Done" /> : <span className="num text-base font-bold" aria-hidden>{n}</span>}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className={`text-lg font-semibold ${phase === "later" ? "text-ink-3" : "text-ink"}`}><span className="sr-only">Step {n}: </span>{title}</h3>
          <p className={`text-base [overflow-wrap:anywhere] ${phase === "later" ? "text-ink-3" : "text-ink-2"}`}>{summary}</p>
        </div>
      </div>
      {children && <div className="rise mt-3">{children}</div>}
    </li>
  );
}

/** Step 1: borrow the shared sandbox wallet, or link a PayPal account. Either one is enough. */
function WalletStep() {
  const demo = useAccount().state.demoWallet.available;
  return (
    <div className="card border-brand p-4 shadow-card sm:p-5">
      {demo ? (
        <p className="text-base text-ink-2">The demo wallet is a shared PayPal sandbox buyer, ready now. Payments are real sandbox payments with a smaller budget. If you have a PayPal sandbox account of your own, link that.</p>
      ) : (
        <p className="text-base text-ink-2">You log in at PayPal once and come straight back here. PayPal saves your wallet for this gateway. Agents never see your login or any payment details.</p>
      )}
      <div className="mt-4 flex flex-wrap items-start gap-2">
        <DemoWalletButton variant="primary" />
        <a href="/api/paypal/link" className={`btn ${demo ? "btn-secondary" : "btn-primary"}`}>Link PayPal<ArrowRight size={15} aria-hidden /></a>
      </div>
      <p className="mt-3 text-sm text-ink-3">This runs against the PayPal sandbox. No real money moves.</p>
    </div>
  );
}

/**
 * Step 2: take the starter sentence or write one. Either way a model compiles it, the visitor reads the exact
 * rules, and nothing takes effect until they confirm. Writing one opens the same composer as the Mandates page.
 */
function MandateStep() {
  const { state } = useAccount();
  const compile = useAction(compileMandateAction), confirm = useAction(confirmMandateAction);
  const [own, setOwn] = useState(false);
  const [draft, setDraft] = useState<NonNullable<Awaited<ReturnType<typeof compile.run>>> | null>(null);

  if (own) return <div className="[&>section]:mb-0"><MandateComposer onClose={() => setOwn(false)} onConfirmed={() => {}} /></div>;

  const quote = (
    <figure className="rounded-[10px] border border-line bg-raised p-4">
      <figcaption className="eyebrow">{draft ? "The mandate" : "A mandate to start with"}</figcaption>
      <blockquote className="quote mt-1 italic [overflow-wrap:anywhere]">“{STARTER}”</blockquote>
    </figure>
  );

  if (!draft) {
    return (
      <div className="card border-brand p-4 shadow-card sm:p-5">
        {quote}
        <p className="mt-3 text-base text-ink-2">A model turns the sentence into exact rules. You read them and confirm before anything takes effect.</p>
        {!state.llm && <Banner tone="warn" className="mt-3" icon={<TriangleAlert size={17} aria-hidden />} title="No model is configured on this gateway">Turning text into rules needs one, so this step may fail.</Banner>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={<Sparkles size={15} aria-hidden />} loading={compile.pending} loadingText="Reading the mandate" onClick={async () => { const r = await compile.run(STARTER); if (r) setDraft(r); }}>Use this mandate</Button>
          <Button icon={<PenLine size={15} aria-hidden />} disabled={compile.pending} onClick={() => setOwn(true)}>Write my own</Button>
        </div>
        {compile.pending && <p className="mt-2 text-sm text-ink-3" role="status">This takes a few seconds.</p>}
        {compile.error && <div className="mt-3"><ErrorText>{compile.error}</ErrorText></div>}
      </div>
    );
  }

  const blocked = draft.questions.some((q) => q.required);
  return (
    <div className="card border-brand p-4 shadow-card sm:p-5">
      <h4 className="display text-xl text-ink">Check the rules, then confirm</h4>
      <div className="mt-3">{quote}</div>
      <p className="mt-4 text-base text-ink-2"><span className="font-semibold text-ink">The gateway understood:</span> {draft.rules.summary}</p>
      {draft.questions.length > 0 && (
        <Banner tone="warn" className="mt-3" icon={<TriangleAlert size={17} aria-hidden />} title={blocked ? "The gateway needs an answer first" : "The wording left something open"}>
          {draft.questions.map((q) => q.question).join(" ")} To answer, write your own mandate.
        </Banner>
      )}
      {draft.warnings.map((w) => <Banner key={w} tone="warn" className="mt-3" icon={<TriangleAlert size={17} aria-hidden />}>{w}</Banner>)}
      <div className="mt-3"><RulesList rules={draft.rules} /></div>
      {draft.examples.length > 0 && (
        <div className="mt-4">
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
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={<PenLine size={15} aria-hidden />} loading={confirm.pending} loadingText="Confirming" disabled={blocked} onClick={() => confirm.run(STARTER, draft.rules)}>Confirm mandate</Button>
        <Button variant="quiet" disabled={confirm.pending} onClick={() => { setDraft(null); confirm.clearError(); setOwn(true); }}>Write my own instead</Button>
      </div>
      <p className="mt-2 text-sm text-ink-3">These exact rules, not the sentence, are what gets enforced. You can replace or revoke the mandate at any time.</p>
      {confirm.error && <div className="mt-3"><ErrorText>{confirm.error}</ErrorText></div>}
    </div>
  );
}

/** Step 3: the built-in assistant, as it is on its own page. Its first suggestion is the request to send. */
function PurchaseStep({ onFinish }: { onFinish: () => void }) {
  const { state } = useAccount();
  const latest = state.purchases[0];
  // The chat scrolls to its own end when it mounts. Put the step's heading back at the top so the suggestions are in view.
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = requestAnimationFrame(() => top.current?.scrollIntoView({ block: "start" })); return () => cancelAnimationFrame(t); }, []);
  return (
    <div ref={top} className="scroll-mt-44 space-y-4 lg:scroll-mt-28">
      {/* The chat brings its own page title, which this screen already has. */}
      <div className="[&>header]:hidden"><Chat /></div>
      {latest ? (
        <section aria-label="The result" className="rise space-y-3">
          <div>
            <h4 className="display text-xl text-ink">That is the whole loop</h4>
            <p className="text-base text-ink-2">The agent asked, the gateway decided, and every step was signed. This is the record.</p>
          </div>
          <PurchaseCard p={latest} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary" onClick={onFinish}>Go to your overview<ArrowRight size={15} aria-hidden /></button>
            <Link href="/agents?new=1" className="btn btn-secondary">Connect your own agent</Link>
          </div>
        </section>
      ) : (
        <p className="text-sm text-ink-3">
          Have an agent of your own? <Link className="link" href="/agents?new=1">Connect it</Link> and it buys under the same mandate.
        </p>
      )}
    </div>
  );
}

const HOW = [
  { icon: <FileSignature size={17} aria-hidden />, title: "You set the rules", body: "“Up to $150 on running shoes, known stores only, ask me above $100.”" },
  { icon: <Bot size={17} aria-hidden />, title: "Your agent asks to buy", body: "It sends the gateway a product page. It never holds a card or your PayPal login." },
  { icon: <ShieldCheck size={17} aria-hidden />, title: "The gateway decides", body: "It reads the store's page itself, then pays, asks you first, or blocks it and says why." },
  { icon: <ScrollText size={17} aria-hidden />, title: "Every step is signed", body: "The record settles what happens next: a refund for you, or evidence the store can take to PayPal." },
];

/**
 * The first-run screen: what the product is, and the three steps from nothing to a first sandbox purchase,
 * all on this page. `onFinish` hands over to the overview once the visitor has seen their first result.
 */
export default function FirstRun({ onFinish }: { onFinish: () => void }) {
  const { state } = useAccount();
  const wallet = !!state.paypal, mandate = state.mandates.length > 0, bought = state.purchases.length > 0;
  const current = !wallet ? 1 : !mandate ? 2 : 3;
  const phase = (n: number, done: boolean): Phase => (done ? "done" : n === current ? "now" : "later");
  const doneCount = [wallet, mandate, bought].filter(Boolean).length;
  const m = state.mandates[0], latest = state.purchases[0];

  return (
    <div>
      <header className="max-w-3xl">
        <p className="eyebrow">Welcome</p>
        <h1 className="display mt-2 text-3xl text-ink sm:text-[2.6rem] sm:leading-[1.1]">Every agent purchase comes with proof. <em className="text-brand-ink">You keep the final say.</em></h1>
        <p className="mt-3 text-lg text-ink-2">
          Mandate sits between any AI shopping agent and your PayPal account. Agents can only ask. The gateway checks every request against rules you set and signs a record of every step.
        </p>
      </header>

      <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)] lg:gap-10">
        <section aria-label="Get set up">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-3">
            <h2 className="text-lg font-semibold text-ink">Three steps to a first purchase</h2>
            <p className="num text-sm text-ink-3" role="status">{doneCount} of 3 done</p>
          </div>
          <ol className="space-y-6">
            <Step n={1} phase={phase(1, wallet)} title="Get a wallet"
              summary={state.paypal ? (state.paypal.demo ? "You are using the shared demo wallet." : `PayPal is linked${state.paypal.email ? ` as ${state.paypal.email}` : ""}.`) : "The PayPal wallet your agents are paid from."}>
              {current === 1 && <WalletStep />}
            </Step>
            <Step n={2} phase={phase(2, mandate)} title="Set a mandate"
              summary={m ? <>{m.rules.summary} <Link href="/mandates" className="link whitespace-nowrap">See the rules</Link></> : "The rules for what an agent may buy and how much it may spend."}>
              {current === 2 && <MandateStep />}
            </Step>
            <Step n={3} phase={phase(3, bought)} title="Make a purchase"
              summary={latest ? `Your agent asked to buy ${latest.productName ?? "a product"}${latest.amountCents ? ` for ${money(latest.amountCents, latest.currency)}` : ""}.`
                : current === 3 ? "Ask the built-in assistant to buy something. Tap the first suggestion or type your own. The gateway pays, asks you first, or blocks it."
                : "Ask the built-in assistant to buy something and watch the gateway decide."}>
              {current === 3 && <PurchaseStep onFinish={onFinish} />}
            </Step>
          </ol>
        </section>

        <aside aria-label="How it works" className="lg:sticky lg:top-9 lg:self-start">
          <h2 className="eyebrow mb-3">How it works</h2>
          <ol className="space-y-4">
            {HOW.map((h, i) => (
              <li key={h.title} className="flex gap-3.5">
                <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2">
                  {h.icon}
                  {i < HOW.length - 1 && <span className="absolute left-1/2 top-full h-4 w-px bg-line-strong" aria-hidden />}
                </span>
                <div>
                  <p className="font-semibold text-ink">{h.title}</p>
                  <p className="text-base text-ink-2">{h.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-5 border-t border-line pt-4 text-sm text-ink-3">
            If something goes wrong, you get your refund on that record, and the store answers a dispute with it.
          </p>
          <p className="mt-3 text-sm text-ink-3">
            Just looking? Browse the <Link className="link" href="/stores/stride">demo stores</Link>, read how <Link className="link" href="/developers">agents connect</Link>, or <Link className="link" href="/verify">check a signed record</Link>.
          </p>
        </aside>
      </div>
    </div>
  );
}
