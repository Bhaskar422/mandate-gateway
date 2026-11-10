import type { Metadata } from "next";
import LedgerCheck from "@/components/public/LedgerCheck";
import Verifier from "@/components/public/Verifier";
import PublicShell from "@/components/shell/PublicShell";

export const metadata: Metadata = { title: "Verify a record" };

/** Public: anyone holding an evidence file (a buyer, a store, PayPal) can check it here without an account. */
export default function VerifyPage() {
  return (
    <PublicShell width="max-w-[760px]">
      <header className="mb-6">
        <p className="eyebrow">Public tool · no account needed</p>
        <h1 className="display mt-1 text-3xl text-ink">Verify an evidence record</h1>
        <p className="mt-2 max-w-2xl text-lg text-ink-2">
          Every purchase made through this gateway has a signed record of what was asked for, what the store&apos;s page said, which rules were checked and what was paid. If someone hands you one, check here that it is genuine and unaltered.
        </p>
      </header>
      <Verifier />
      <section aria-label="How verification works" className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          { t: "Signed by this gateway", b: "Each entry carries an Ed25519 signature. It must verify against this gateway's public key, published at /.well-known/mandate-gateway.json." },
          { t: "Unaltered", b: "Each entry's SHA-256 hash covers its content and the previous entry's hash. Changing one character anywhere breaks it." },
          { t: "Anchored", b: "The gateway publishes a signed head of the whole ledger at /api/ledger/head. Record that value today and you can later prove the ledger was not rewritten behind it." },
        ].map((x) => (
          <div key={x.t} className="card p-4">
            <h2 className="font-semibold text-ink">{x.t}</h2>
            <p className="mt-1 text-sm text-ink-2 [overflow-wrap:anywhere]">{x.b}</p>
          </div>
        ))}
      </section>
      <LedgerCheck />
      <p className="mt-4 text-sm text-ink-3">
        <a className="link" href="/.well-known/mandate-gateway.json">Gateway public key</a> · <a className="link" href="/api/ledger/head">Signed ledger head</a>. The record is sent to this gateway to be checked and is not stored.
      </p>
    </PublicShell>
  );
}
