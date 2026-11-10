"use client";
import { BadgeCheck, FileUp, ShieldX } from "lucide-react";
import { useRef, useState } from "react";
import { verifyEvidenceAction } from "@/app/actions";
import { ledgerEntry } from "../format";
import LocalTime from "../LocalTime";
import Banner from "../ui/Banner";
import Button from "../ui/Button";
import { useAction } from "../useAction";

type Result = { purchaseId: string | null; entries: { seq: number; type: string; at: string }[] };

/** Paste or drop an evidence file; the gateway re-checks every entry's hash and signature against its own key. */
export default function Verifier() {
  const verify = useAction(verifyEvidenceAction);
  const [json, setJson] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [over, setOver] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = async (file: File | undefined) => {
    if (!file) return;
    setReadError(null); setResult(null); verify.clearError();
    if (file.size > 5_000_000) { setReadError("That file is larger than 5 MB, which is too big to be an evidence record."); return; }
    try { setJson(await file.text()); setFileName(file.name); } catch { setReadError("That file could not be read."); }
  };
  const check = async (e: React.FormEvent) => { e.preventDefault(); setResult(null); const r = await verify.run(json); if (r) setResult({ purchaseId: r.purchaseId, entries: r.entries }); };

  return (
    <div className="space-y-5">
      <form onSubmit={check} className="card p-5 sm:p-6">
        <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]); }}
          className={`rounded-[10px] border border-dashed p-4 text-center transition-colors ${over ? "border-brand bg-brand-soft" : "border-line-strong bg-raised"}`}>
          <FileUp size={20} className="mx-auto text-ink-3" aria-hidden />
          <p className="mt-1.5 text-base text-ink-2">Drop an evidence file here, or</p>
          <Button className="mt-2" size="sm" onClick={() => input.current?.click()} disabled={verify.pending}>Choose a file</Button>
          <input ref={input} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-label="Evidence file" onChange={(e) => { load(e.target.files?.[0]); e.target.value = ""; }} />
          {fileName && <p className="code mt-2 text-ink-3 [overflow-wrap:anywhere]">{fileName}</p>}
        </div>
        <label htmlFor="evidence-json" className="field-label mt-4">Or paste the record</label>
        <textarea id="evidence-json" className="field code" rows={7} spellCheck={false} value={json} onChange={(e) => { setJson(e.target.value); setFileName(null); setResult(null); verify.clearError(); }}
          placeholder={'{\n  "purchaseId": "pur_…",\n  "publicKey": "-----BEGIN PUBLIC KEY-----…",\n  "entries": [ … ]\n}'} disabled={verify.pending} />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" loading={verify.pending} loadingText="Checking signatures" disabled={!json.trim()}>Check this record</Button>
          {json && <Button variant="quiet" disabled={verify.pending} onClick={() => { setJson(""); setFileName(null); setResult(null); setReadError(null); verify.clearError(); }}>Clear</Button>}
        </div>
      </form>

      <div aria-live="polite">
        {(verify.error || readError) && (
          <Banner tone="bad" icon={<ShieldX size={18} aria-hidden />} title="This record is not authentic, or is not an evidence record">
            {verify.error ?? readError} Do not rely on it. A genuine record downloaded from this gateway verifies exactly as downloaded; any edit to it breaks a signature.
          </Banner>
        )}
        {result && (
          <div className="rise space-y-4">
            <Banner tone="ok" icon={<BadgeCheck size={18} aria-hidden />} title="Authentic">
              All {result.entries.length} entries were signed by this gateway and none has been altered{result.purchaseId && <>. Purchase <span className="code">{result.purchaseId}</span></>}.
            </Banner>
            <div className="card p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-ink">What the record contains</h2>
              <ol className="mt-3 divide-y divide-line border-y border-line">
                {result.entries.map((e) => (
                  <li key={e.seq} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5">
                    <p className="text-base text-ink"><span className="code mr-2 text-ink-3">#{e.seq}</span>{ledgerEntry(e.type).title}<span className="code ml-2 text-[11px] text-ink-3">{e.type}</span></p>
                    <LocalTime iso={e.at} className="num text-sm text-ink-3" />
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
