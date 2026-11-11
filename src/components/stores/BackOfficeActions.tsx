"use client";
import { Gavel, PackageCheck, PackageX, RefreshCw, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { publishTokenAction, sandboxRulingAction, shipOrderAction, syncDisputesAction } from "@/app/actions";
import Banner, { ErrorText } from "../ui/Banner";
import Button from "../ui/Button";

/** The back-office actions throw on failure instead of returning an error, so each call is wrapped here. */
function useStoreAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (name: string, fn: () => Promise<unknown>, after?: (result: unknown) => void) => {
    setRunning(name); setError(null);
    start(async () => {
      try { const r = await fn(); after?.(r); router.refresh(); }
      catch (e) { setError(e instanceof Error && e.message ? e.message : "That did not work. Try again."); }
      finally { setRunning(null); }
    });
  };
  return { run, pending, running: pending ? running : null, error };
}

/** Ship an order correctly, ship the wrong item (to demonstrate a refund), or play PayPal's ruling on a dispute. */
export function OrderActions({ slug, orderId, sku, wrongSku, wrongName, canShip, canRule }: { slug: string; orderId: string; sku: string; wrongSku: string | null; wrongName: string | null; canShip: boolean; canRule: boolean }) {
  const { run, pending, running, error } = useStoreAction();
  if (!canShip && !canRule) return null;
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap gap-2">
        {canShip && <Button size="sm" variant="primary" icon={<PackageCheck size={13} aria-hidden />} loading={running === "ship"} disabled={pending} onClick={() => run("ship", () => shipOrderAction(slug, orderId, sku))}>Ship the order</Button>}
        {canShip && wrongSku && <Button size="sm" variant="danger" icon={<PackageX size={13} aria-hidden />} loading={running === "wrong"} disabled={pending} onClick={() => run("wrong", () => shipOrderAction(slug, orderId, wrongSku))}>Ship the wrong item</Button>}
        {canRule && <Button size="sm" icon={<Gavel size={13} aria-hidden />} loading={running === "rule"} disabled={pending} onClick={() => run("rule", () => sandboxRulingAction(slug, orderId))}>Sandbox: play PayPal&apos;s ruling</Button>}
      </div>
      {canShip && wrongSku && <p className="mt-2 text-xs text-ink-3">“Ship the wrong item” is for the demo: the warehouse sends {wrongName ?? wrongSku} instead, so the buyer has a real problem to report.</p>}
      {canRule && <p className="mt-2 text-xs text-ink-3">The PayPal sandbox has no human reviewer, so this stands in for one and rules on the evidence the store submitted.</p>}
      {error && <div className="mt-2"><ErrorText>{error}</ErrorText></div>}
    </div>
  );
}

type SyncResult = { error?: string; handled?: { disputeId?: string; action?: string; reason?: string }[] };

/** Ask PayPal for this store's disputes; the store's agent answers each one with the signed record. */
export function DisputeSync({ slug, enabled }: { slug: string; enabled: boolean }) {
  const { run, pending, error } = useStoreAction();
  const [result, setResult] = useState<SyncResult | null>(null);
  return (
    <div>
      <Button icon={<RefreshCw size={15} aria-hidden />} loading={pending} loadingText="Checking PayPal" disabled={!enabled} title={enabled ? undefined : "This store has no PayPal credentials configured"}
        onClick={() => { setResult(null); run("sync", () => syncDisputesAction(slug), (r) => setResult((r ?? {}) as SyncResult)); }}>Check PayPal for disputes</Button>
      {!enabled && <p className="mt-1.5 text-xs text-ink-3">Needs this store&apos;s own PayPal credentials, which are not configured here.</p>}
      <div aria-live="polite" className="mt-2 space-y-2 empty:mt-0">
        {error && <ErrorText>{error}</ErrorText>}
        {result?.error && <ErrorText>{result.error}</ErrorText>}
        {result?.handled && (
          <Banner tone="info" title={result.handled.length ? `PayPal returned ${result.handled.length} ${result.handled.length === 1 ? "dispute" : "disputes"}` : "No disputes on this store's PayPal account"}>
            {result.handled.length === 0 && "PayPal can take two or three minutes to list a dispute after the buyer opens it. If one was just opened, check again shortly."}
            {result.handled.length > 0 && <ul className="mt-1 space-y-0.5">{result.handled.map((h, i) => <li key={i}><span className="code">{h.disputeId}</span>: {h.action}{h.reason ? ` (${h.reason})` : ""}</li>)}</ul>}
          </Banner>
        )}
      </div>
    </div>
  );
}

/** Stands in for the store owner editing their website: publish the token the gateway issued. */
export function PublishToken({ slug, current }: { slug: string; current: string | null }) {
  const { run, pending, running, error } = useStoreAction();
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form onSubmit={(e) => { e.preventDefault(); setSaved(false); run("publish", () => publishTokenAction(slug, token), () => { setSaved(true); setToken(""); }); }}>
      <label htmlFor="verify-token" className="field-label">Verification token from the gateway</label>
      <div className="flex flex-wrap gap-2">
        <input id="verify-token" className="field code min-w-0 flex-1 basis-64" value={token} onChange={(e) => setToken(e.target.value)} placeholder="mandate-verify-…" maxLength={200} disabled={pending} autoComplete="off" spellCheck={false} />
        <Button type="submit" variant="primary" icon={<Upload size={15} aria-hidden />} loading={running === "publish"} loadingText="Publishing" disabled={pending || !token.trim()}>Publish on the site</Button>
        {current && <Button loading={running === "remove"} disabled={pending} onClick={() => { setSaved(false); run("remove", () => publishTokenAction(slug, "")); }}>Remove</Button>}
      </div>
      <p className="field-hint">You get this token on Mandate&apos;s Merchants page after entering this store&apos;s address. Publishing puts it in the store&apos;s <span className="code">mandate-merchant.json</span> file.</p>
      <div aria-live="polite">
        {saved && <p className="rise mt-2 text-sm font-medium text-ok-ink">Published. Go back to Mandate and press “Check the file now”.</p>}
        {error && <div className="mt-2"><ErrorText>{error}</ErrorText></div>}
      </div>
    </form>
  );
}
