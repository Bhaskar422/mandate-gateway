"use client";
import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useAccount } from "../AccountProvider";
import DemoWalletButton from "../DemoWalletButton";

/** The three things a new account needs before an agent can buy anything. */
export function useSetup() {
  const { state } = useAccount();
  const steps = [
    { key: "paypal", done: !!state.paypal, title: "Link your PayPal account",
      body: "You log in at PayPal once and it saves your wallet for this gateway. Agents never see your PayPal login or any payment details. Your PayPal account is also how you sign in: link the same one on another browser and this account comes back.",
      done_text: state.paypal ? (state.paypal.demo ? "Using the shared demo wallet." : `Linked${state.paypal.email ? ` as ${state.paypal.email}` : ""}.`) : "", cta: "Link PayPal", href: "/api/paypal/link", external: true, alt: null as { label: string; href: string } | null },
    { key: "mandate", done: state.mandates.length > 0, title: "Write a mandate",
      body: "Say in plain English what an agent may buy and how much it may spend. You review the exact rules before they take effect.",
      done_text: `${state.mandates.length} active.`, cta: "Write a mandate", href: "/mandates?new=1", external: false, alt: null },
    { key: "agent", done: state.agents.some((a) => a.status !== "revoked"), title: "Connect an agent, or use the built-in one",
      body: "Give Claude, Cursor or your own agent a key to this gateway. It can then ask the gateway to pay, and only that. To try it with no setup, use the shopping assistant in this dashboard.",
      done_text: `${state.agents.filter((a) => a.status !== "revoked").length} connected.`, cta: "Connect an agent", href: "/agents?new=1", external: false, alt: { label: "Use the built-in assistant", href: "/assistant" } },
  ];
  return { steps, doneCount: steps.filter((s) => s.done).length, complete: steps.every((s) => s.done) };
}

function Steps() {
  const { steps } = useSetup();
  const demo = useAccount().state.demoWallet.available;
  const next = steps.find((s) => !s.done)?.key;
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={s.key} className={`card flex gap-4 p-4 sm:p-5 ${s.key === next ? "border-brand shadow-card" : ""}`}>
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${s.done ? "bg-ok-soft text-ok-ink" : s.key === next ? "bg-brand text-on-brand" : "bg-sunken text-ink-3"}`}>
            {s.done ? <Check size={18} aria-label="Done" /> : <span className="num text-base font-bold" aria-hidden>{i + 1}</span>}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-ink">{s.title}</h3>
            <p className="mt-0.5 text-base text-ink-2">{s.done ? s.done_text : s.body}</p>
            {s.key === "paypal" && !s.done && demo && <p className="mt-1.5 text-sm text-ink-3">No PayPal sandbox account? The demo wallet is a shared sandbox buyer you can use straight away. Purchases are real sandbox payments, with a smaller budget.</p>}
            {!s.done && (
              <div className="mt-3 flex flex-wrap gap-2">
                {s.external
                  ? <a href={s.href} className={`btn ${s.key === next ? "btn-primary" : "btn-secondary"}`}>{s.cta}<ArrowRight size={15} aria-hidden /></a>
                  : <Link href={s.href} className={`btn ${s.key === next ? "btn-primary" : "btn-secondary"}`}>{s.cta}<ArrowRight size={15} aria-hidden /></Link>}
                {s.alt && <Link href={s.alt.href} className="btn btn-secondary">{s.alt.label}</Link>}
                {s.key === "paypal" && <DemoWalletButton />}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** For an account that has started but not finished setting up. */
export function SetupChecklist() {
  const { doneCount, complete } = useSetup();
  if (complete) return null;
  return (
    <section aria-label="Finish setting up" className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Finish setting up</h2>
        <p className="num text-sm text-ink-3">{doneCount} of 3 done</p>
      </div>
      <Steps />
    </section>
  );
}
