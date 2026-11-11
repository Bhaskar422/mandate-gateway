"use client";
import { BadgeCheck, ExternalLink, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearDemoWalletAction, operatorSignInAction, operatorSignOutAction, removeMerchantAction, reviewMerchantAction, setDemoWalletAction } from "@/app/actions";
import type { MerchantView } from "@/lib/views";
import LocalTime from "../LocalTime";
import { TRUST } from "../merchants/trust";
import { Badge } from "../ui/Badge";
import { ErrorText } from "../ui/Banner";
import Button from "../ui/Button";
import ConfirmButton from "../ui/ConfirmButton";
import { useAction } from "../useAction";

function Row({ m, onChange }: { m: MerchantView; onChange: () => void }) {
  const review = useAction(reviewMerchantAction), remove = useAction(removeMerchantAction);
  const t = TRUST[m.trust], busy = review.pending || remove.pending;
  return (
    <li className="p-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">{m.name}</p>
          <a href={m.baseUrl} target="_blank" rel="noreferrer" className="code inline-flex items-start gap-1 text-ink-3 hover:text-ink [overflow-wrap:anywhere]">{m.baseUrl}<ExternalLink size={11} className="mt-1 shrink-0" aria-hidden /></a>
          <p className="mt-1 text-sm text-ink-3">
            {m.source === "builtin" ? "Ships with the gateway." : m.domainVerifiedAt ? <>Proved ownership <LocalTime iso={m.domainVerifiedAt} format="date" />.</> : <>Address entered <LocalTime iso={m.createdAt} format="date" />; ownership not proved.</>}
            {" "}{m.payable ? "PayPal payee on file." : "No PayPal payee on file."}
          </p>
        </div>
        <Badge tone={t.tone} icon={t.icon}>{t.label}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {m.trust === "verified"
          ? <ConfirmButton variant="secondary" question="Mandates that allow known merchants only will stop paying this store. Withdraw?" confirmLabel="Withdraw" loading={review.pending} onConfirm={async () => { if (await review.run(m.id, false)) onChange(); }}>Withdraw verified status</ConfirmButton>
          : <Button size="sm" variant="primary" icon={<BadgeCheck size={13} aria-hidden />} loading={review.pending} disabled={busy || m.trust === "pending" || !m.payable} onClick={async () => { if (await review.run(m.id, true)) onChange(); }}>Mark as verified</Button>}
        {m.source === "onboarded" && <ConfirmButton question="Remove this store from the registry?" confirmLabel="Remove" loading={remove.pending} icon={<Trash2 size={13} aria-hidden />} onConfirm={async () => { if (await remove.run(m.id)) onChange(); }}>Remove</ConfirmButton>}
        {m.trust === "pending" && <span className="text-sm text-ink-3">A store must prove ownership before it can be verified.</span>}
      </div>
      <ErrorText>{review.error ?? remove.error}</ErrorText>
    </li>
  );
}

/** The operator's review queue: grant or withdraw verified status, and remove stores that should not be listed. */
function DemoWallet({ setAt, onChange }: { setAt: string | null; onChange: () => void }) {
  const set = useAction(setDemoWalletAction), clear = useAction(clearDemoWalletAction);
  return (
    <section aria-label="Demo wallet" className="card mt-8 p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-ink">Demo wallet</h2>
      <p className="mt-1 max-w-2xl text-base text-ink-2">
        Visitors without a PayPal sandbox account can borrow one sandbox buyer to try a real sandbox purchase. Everyone who uses it spends from the same sandbox balance, so each mandate is capped and there is a daily total. It is never used to sign anyone in.
      </p>
      <p className="mt-3 text-base text-ink">{setAt ? <>A demo wallet is set (since <LocalTime iso={setAt} format="date" />). The dashboard offers it to visitors with no wallet.</> : "No demo wallet is set, so visitors must link their own PayPal sandbox account."}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant={setAt ? "secondary" : "primary"} loading={set.pending} onClick={async () => { if (await set.run()) onChange(); }}>{setAt ? "Replace with the wallet linked in this browser" : "Use the wallet linked in this browser"}</Button>
        {setAt && <ConfirmButton question="Stop offering the demo wallet? Accounts already using it keep working." confirmLabel="Stop" loading={clear.pending} onConfirm={async () => { if (await clear.run()) onChange(); }}>Stop offering it</ConfirmButton>}
      </div>
      <ErrorText>{set.error ?? clear.error}</ErrorText>
    </section>
  );
}

export default function Review({ configured, signedIn, merchants, demoWalletSetAt }: { configured: boolean; signedIn: boolean; merchants: MerchantView[]; demoWalletSetAt: string | null }) {
  const router = useRouter();
  const signIn = useAction(operatorSignInAction), signOut = useAction(operatorSignOutAction);
  const [key, setKey] = useState("");

  if (!signedIn) return (
    <div className="mx-auto max-w-md py-8">
      <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand-ink"><ShieldCheck size={20} aria-hidden /></span>
      <h1 className="display text-2xl text-ink">Operator sign-in</h1>
      <p className="mt-1 text-base text-ink-2">This page is for the people who run this gateway. Shoppers and stores do not need it.</p>
      {configured ? (
        <form className="mt-5" onSubmit={async (e) => { e.preventDefault(); if (await signIn.run(key)) { setKey(""); router.refresh(); } }}>
          <label htmlFor="operator-key" className="field-label">Operator key</label>
          <input id="operator-key" type="password" autoComplete="off" className="field code" value={key} onChange={(e) => setKey(e.target.value)} required disabled={signIn.pending} />
          <div className="mt-3"><Button type="submit" variant="primary" loading={signIn.pending} disabled={!key.trim()}>Sign in</Button></div>
          <div className="mt-2"><ErrorText>{signIn.error}</ErrorText></div>
        </form>
      ) : <p className="mt-4 text-base text-ink-2">No operator key is configured on this deployment. Set <span className="code">OPERATOR_KEY</span> to enable reviews.</p>}
    </div>
  );

  const order = { pending: 2, registered: 0, verified: 1 } as const;
  const rows = [...merchants].sort((a, b) => order[a.trust] - order[b.trust] || a.name.localeCompare(b.name));
  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="eyebrow">Operator</p>
          <h1 className="display mt-1 text-3xl text-ink">Store review</h1>
          <p className="mt-2 text-base text-ink-2">A registered store has only proved it owns its website. Marking it verified is your judgement that it is a real, trustworthy business: mandates that say “known merchants only” will then pay it. Each decision is written to the signed ledger.</p>
        </div>
        <Button icon={<LogOut size={14} aria-hidden />} loading={signOut.pending} onClick={async () => { if (await signOut.run()) router.refresh(); }}>Sign out</Button>
      </header>
      <ul className="card divide-y divide-line">{rows.map((m) => <Row key={m.id} m={m} onChange={() => router.refresh()} />)}</ul>
      <DemoWallet setAt={demoWalletSetAt} onChange={() => router.refresh()} />
    </>
  );
}
