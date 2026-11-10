"use client";
import { BadgeCheck, Link2, ShieldX } from "lucide-react";
import { useState } from "react";
import Banner from "../ui/Banner";
import Button from "../ui/Button";

type Result = { ok: true; entries: number; head: string } | { ok: false; brokenAt: number; why: string };

/** Recomputes every hash and signature in the gateway's whole ledger, not only one purchase's entries. */
export default function LedgerCheck() {
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const check = async () => {
    setPending(true); setFailed(false); setResult(null);
    try { const r = await fetch("/api/ledger/verify", { cache: "no-store" }); if (!r.ok) throw new Error(); setResult(await r.json()); }
    catch { setFailed(true); }
    finally { setPending(false); }
  };
  return (
    <section aria-label="Check the whole ledger" className="card mt-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-xl">
          <h2 className="text-lg font-semibold text-ink">Check the whole ledger</h2>
          <p className="mt-0.5 text-sm text-ink-2">A single record proves its own entries. This re-checks the full chain behind them: every entry of every purchase, in order, back to the first.</p>
        </div>
        <Button icon={<Link2 size={15} aria-hidden />} loading={pending} loadingText="Checking the chain" onClick={check}>Check the chain now</Button>
      </div>
      <div aria-live="polite" className="mt-3 empty:mt-0">
        {failed && <Banner tone="bad" icon={<ShieldX size={18} aria-hidden />} title="The check could not be run">The gateway did not answer. Try again in a moment.</Banner>}
        {result?.ok && (
          <Banner tone="ok" icon={<BadgeCheck size={18} aria-hidden />} title={`The chain is intact: ${result.entries} entries`}>
            Nothing has been edited, removed or reordered. Current head: <span className="code break-all">{result.head}</span>
          </Banner>
        )}
        {result && !result.ok && <Banner tone="bad" role="alert" icon={<ShieldX size={18} aria-hidden />} title={`The chain is broken at entry ${result.brokenAt}`}>The {result.why}. Records from before that entry still verify on their own.</Banner>}
      </div>
    </section>
  );
}
