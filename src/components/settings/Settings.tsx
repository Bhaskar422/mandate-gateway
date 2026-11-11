"use client";
import { BellRing, CircleCheck, LogOut, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { signOutAction, updateSettingsAction } from "@/app/actions";
import { useAccount } from "../AccountProvider";
import { money } from "../format";
import LocalTime from "../LocalTime";
import { KillSwitch } from "../shell/KillSwitch";
import ThemeToggle from "../shell/ThemeToggle";
import { Badge } from "../ui/Badge";
import { ErrorText } from "../ui/Banner";
import Button from "../ui/Button";
import ConfirmButton from "../ui/ConfirmButton";
import { PageHeader, Section } from "../ui/Layout";
import { useAction } from "../useAction";

const Saved = ({ show }: { show: boolean }) => (show ? <span className="rise inline-flex items-center gap-1 text-sm font-medium text-ok-ink" role="status"><CircleCheck size={14} aria-hidden />Saved</span> : null);

/** What the buyer's agent may accept from a store without asking. */
function SettlementRules() {
  const { state } = useAccount();
  const saved = state.account.settings;
  const save = useAction(updateSettingsAction);
  const [ask, setAsk] = useState(saved.autoAcceptRefundPercent >= 100);
  const [pct, setPct] = useState(saved.autoAcceptRefundPercent >= 100 ? 60 : saved.autoAcceptRefundPercent);
  const [replacement, setReplacement] = useState(saved.autoAcceptReplacement);
  const [done, setDone] = useState(false);
  const value = ask ? 100 : pct;
  const dirty = value !== saved.autoAcceptRefundPercent || replacement !== saved.autoAcceptReplacement;
  useEffect(() => { if (dirty) setDone(false); }, [dirty]);
  const example = 8900;

  return (
    <form className="card p-5 sm:p-6" onSubmit={async (e) => { e.preventDefault(); if (await save.run({ autoAcceptRefundPercent: value, autoAcceptReplacement: replacement })) setDone(true); }}>
      <p className="max-w-2xl text-base text-ink-2">
        When you report a problem, your agent asks the store for a full refund. A store whose own records cannot confirm the problem may offer less instead. These rules say what your agent may accept on the spot. A full refund is always accepted.
      </p>

      <fieldset className="mt-5" disabled={save.pending}>
        <legend className="field-label">If the store offers a partial refund</legend>
        <label className="flex items-start gap-2.5 py-1.5 text-base"><input type="radio" name="partial" className="mt-1" checked={ask} onChange={() => setAsk(true)} /><span><span className="font-medium text-ink">Always ask me</span><span className="block text-sm text-ink-3">Every partial offer waits for your decision.</span></span></label>
        <label className="flex items-start gap-2.5 py-1.5 text-base"><input type="radio" name="partial" className="mt-1" checked={!ask} onChange={() => setAsk(false)} /><span><span className="font-medium text-ink">Accept it for me when it is big enough</span><span className="block text-sm text-ink-3">Smaller offers still wait for you. Your agent also uses this number as its counter-offer.</span></span></label>
        {!ask && (
          <div className="ml-6 mt-2 max-w-md rounded-[10px] border border-line bg-raised p-4">
            <label htmlFor="pct" className="flex items-baseline justify-between text-sm font-medium text-ink"><span>Accept offers of at least</span><span className="display num text-2xl">{pct}%</span></label>
            <input id="pct" type="range" min={1} max={99} step={1} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="mt-2 w-full" aria-valuetext={`${pct} percent of the price`} />
            <p className="mt-2 text-sm text-ink-2">On a {money(example)} purchase, your agent accepts a refund of <span className="num font-semibold text-ink">{money(Math.ceil((example * pct) / 100))}</span> or more and lets you keep the item. Anything lower comes to you.</p>
          </div>
        )}
      </fieldset>

      <fieldset className="mt-5" disabled={save.pending}>
        <legend className="field-label">If the store offers a replacement</legend>
        <label className="flex items-start gap-2.5 py-1.5 text-base"><input type="checkbox" className="mt-1" checked={replacement} onChange={(e) => setReplacement(e.target.checked)} /><span><span className="font-medium text-ink">Accept a replacement for me</span><span className="block text-sm text-ink-3">Off: a replacement offer waits for your decision, like any other.</span></span></label>
      </fieldset>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button type="submit" variant="primary" loading={save.pending} loadingText="Saving" disabled={!dirty}>Save settlement rules</Button>
        <Saved show={done && !dirty} />
      </div>
      {save.error && <div className="mt-2"><ErrorText>{save.error}</ErrorText></div>}
    </form>
  );
}

/** One webhook the gateway posts to when something needs the user. */
function Alerts() {
  const { state } = useAccount();
  const saved = state.account.settings.notifyUrl ?? "";
  const save = useAction(updateSettingsAction);
  const [url, setUrl] = useState(saved);
  const [done, setDone] = useState(false);
  const dirty = url.trim() !== saved;
  const submit = async (value: string) => { if (await save.run({ notifyUrl: value })) { setUrl(value); setDone(true); } };

  return (
    <form className="card p-5 sm:p-6" onSubmit={(e) => { e.preventDefault(); submit(url.trim()); }}>
      <div className="flex flex-wrap items-center gap-2">
        <BellRing size={17} className="text-ink-3" aria-hidden />
        <label htmlFor="notify-url" className="text-lg font-semibold text-ink">Send alerts to a webhook</label>
        {saved ? <Badge tone="ok">On</Badge> : <Badge tone="neutral">Off</Badge>}
      </div>
      <p className="mt-1.5 max-w-2xl text-base text-ink-2">
        The gateway posts a short message to this address when a purchase needs your approval, a purchase is blocked, a store&apos;s page tries to steer an agent, an agent is paused, a store makes an offer that needs your answer, or a refund arrives.
        It works with a Slack or Discord incoming webhook, an ntfy topic, or any https endpoint of your own.
      </p>
      <div className="mt-4 max-w-xl">
        <input id="notify-url" className="field code" type="url" inputMode="url" value={url} onChange={(e) => { setUrl(e.target.value); setDone(false); }} placeholder="https://ntfy.sh/my-private-topic" disabled={save.pending} aria-describedby="notify-hint" />
        <p id="notify-hint" className="field-hint">Must be a public https address. Anyone who knows it can read your alerts there, so treat it like a password.</p>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" loading={save.pending} loadingText="Saving" disabled={!dirty || !url.trim()}>Save</Button>
        {saved && <Button disabled={save.pending} onClick={() => submit("")}>Turn off alerts</Button>}
        <Saved show={done && !dirty} />
      </div>
      {save.error && <div className="mt-2"><ErrorText>{save.error}</ErrorText></div>}
    </form>
  );
}

function SignOut() {
  const { state } = useAccount();
  const out = useAction(signOutAction);
  return (
    <div className="card flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
      <div className="max-w-xl">
        <p className="text-lg font-semibold text-ink">Sign out of this browser</p>
        <p className="text-sm text-ink-3">
          {state.paypal
            ? "Your account stays as it is. To come back, on this or any browser, link the same PayPal account and you are signed in to it again."
            : "You have not linked PayPal, so nothing identifies this account yet. If you sign out now, this dashboard cannot be recovered."}
        </p>
        <ErrorText>{out.error}</ErrorText>
      </div>
      <ConfirmButton variant="secondary" question={state.paypal ? "Sign out of this browser?" : "This account cannot be recovered. Sign out anyway?"} confirmLabel="Sign out" loading={out.pending} icon={<LogOut size={14} aria-hidden />}
        onConfirm={async () => { if (await out.run()) window.location.assign("/"); }}>Sign out</ConfirmButton>
    </div>
  );
}

/** Account-wide choices: settlement rules, alerts, the PayPal link, the kill switch and the theme. */
export default function Settings() {
  const { state } = useAccount();
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-8">
        <Section title="Settlement rules" hint="How far your agent may go by itself when something goes wrong with a purchase."><SettlementRules /></Section>
        <Section title="Alerts"><Alerts /></Section>

        <Section title="PayPal">
          <div className="card flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
            <div className="flex min-w-0 items-start gap-3">
              <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${state.paypal ? "bg-ok-soft text-ok-ink" : "bg-warn-soft text-warn-ink"}`}><Wallet size={17} aria-hidden /></span>
              <div className="min-w-0">
                <p className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">{state.paypal ? `Linked${state.paypal.email ? ` as ${state.paypal.email}` : ""}` : "Not linked"}</p>
                <p className="max-w-xl text-sm text-ink-3">
                  {state.paypal ? "PayPal holds your saved wallet; the gateway holds a token that only works for this gateway. Agents see neither."
                    : "Until you link PayPal, every purchase is blocked. You log in at PayPal; the gateway never sees your password."}
                  {state.simulated && " Payments are simulated on this deployment."}
                </p>
              </div>
            </div>
            <a href="/api/paypal/link" className={`btn ${state.paypal ? "btn-secondary" : "btn-primary"}`}>{state.paypal ? "Link a different account" : "Link PayPal"}</a>
          </div>
        </Section>

        <Section title="Account" hint="Your PayPal account is your sign-in. There is no separate password."><SignOut /></Section>

        <Section title="Kill switch">
          <div className="card flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
            <div className="max-w-xl">
              <p className="text-lg font-semibold text-ink">{state.account.frozen ? "All agent spending is frozen" : "Freeze all agent spending"}</p>
              <p className="text-sm text-ink-3">
                {state.account.frozen
                  ? <>Frozen{state.account.frozenAt && <> since <LocalTime iso={state.account.frozenAt} /></>}. Every purchase request is blocked and waiting approvals cannot be paid.</>
                  : "One click blocks every purchase from every agent, including approvals already waiting. Mandates and agents stay as they are, and you can unfreeze at any time."}
              </p>
            </div>
            <KillSwitch layout="panel" />
          </div>
        </Section>

        <Section title="This browser">
          <div className="card flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
            <p className="max-w-xl text-sm text-ink-3">Your account here is an anonymous session kept in a cookie in this browser, not a login. Clearing cookies starts a new, empty account. The theme follows your system until you choose one.</p>
            <ThemeToggle withLabel className="!border-line-strong" />
          </div>
        </Section>
      </div>
    </>
  );
}
