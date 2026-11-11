"use client";
import { Ban, ChevronDown, Circle, CircleCheck, CircleX, Hand, LoaderCircle, Lock, Play, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PurchaseView } from "@/lib/views";
import { checkFailed, checkLabel, plural, type Tone } from "../format";

type Check = PurchaseView["checks"][number];

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** What the decision came to, in the words the rest of the app uses. `reserved` is true when PayPal held the money instead of charging it. */
export function decisionOutcome(outcome: string, status: string, reserved = false): { tone: Tone; label: string; icon: React.ReactNode } {
  if (outcome === "block") return { tone: "bad", label: "Blocked", icon: <Ban size={18} aria-hidden /> };
  if (outcome === "needs_approval") return { tone: "warn", label: "Asks you first", icon: <Hand size={18} aria-hidden /> };
  if (reserved || status === "authorized" || status === "cancelled") return { tone: "info", label: "Reserved", icon: <Lock size={18} aria-hidden /> };
  if (status === "payment_failed") return { tone: "bad", label: "Allowed, but the payment failed", icon: <CircleX size={18} aria-hidden /> };
  if (status === "paying") return { tone: "neutral", label: "Allowed", icon: <CircleCheck size={18} aria-hidden /> };
  return { tone: "ok", label: "Paid", icon: <Wallet size={18} aria-hidden /> };
}

/** "21 checks passed, all in code except 1." */
export function checksSummary(checks: Check[]) {
  const failed = checks.find((c) => !c.passed);
  const passed = checks.filter((c) => c.passed).length;
  const byModel = checks.filter((c) => c.enforcedBy === "model").length;
  const where = byModel === 0 ? "all in code" : `all in code except ${byModel}`;
  if (!failed) return `${plural(passed, "check")} passed, ${where}.`;
  return `${passed} of ${plural(checks.length, "check")} passed, ${where}. Failed: ${checkFailed(failed.rule)}.`;
}

function By({ by }: { by: Check["enforcedBy"] }) {
  return by === "model"
    ? <span className="tone-dispute tone-softbg tone-text code shrink-0 rounded px-1.5 !text-[11px]" title="A model read the product and answered this. Its answer can only narrow what is allowed.">model</span>
    : <span className="code shrink-0 rounded border border-line bg-raised px-1.5 !text-[11px] text-ink-3" title="A fixed rule in code. No model output can change it.">code</span>;
}

/**
 * One decision, shown the way it was made: each check resolves in the order the policy engine ran it, then the outcome.
 * At rest it is a one-line summary that opens to the same list. With reduced motion the final state shows at once.
 */
export default function DecisionReveal({ checks, outcome, status, reason, reserved, autoPlay = false, collapseAfter = false, defaultOpen = false, replayLabel = "Replay the decision" }: {
  checks: Check[]; outcome: string; status: string; reason: string; reserved?: boolean;
  /** Play once when the component first appears. */
  autoPlay?: boolean;
  /** Fold back to the summary line a moment after a reveal ends. */
  collapseAfter?: boolean;
  defaultOpen?: boolean; replayLabel?: string;
}) {
  const n = checks.length;
  // `at` is how many checks have resolved; n + 1 means the outcome is showing too.
  const [at, setAt] = useState(() => (autoPlay && !reducedMotion() ? 0 : n + 1));
  const [run, setRun] = useState(autoPlay ? 1 : 0);
  const [open, setOpen] = useState(() => (autoPlay && !reducedMotion()) || defaultOpen);
  const fold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopFold = () => { if (fold.current) clearTimeout(fold.current); fold.current = null; };

  useEffect(() => {
    if (run === 0 || reducedMotion()) { setAt(n + 1); return; }
    // 120 to 180 ms a check, and never more than about 2.6 seconds for the whole list.
    const step = Math.min(180, Math.max(40, Math.floor(2600 / (n + 1))));
    let i = 0;
    setAt(0);
    const t = setInterval(() => {
      i += 1; setAt(i);
      if (i <= n) return;
      clearInterval(t);
      if (collapseAfter) fold.current = setTimeout(() => setOpen(false), 2200);
    }, step);
    return () => { clearInterval(t); if (fold.current) clearTimeout(fold.current); };
  }, [run, n, collapseAfter]);

  if (n === 0) return null;
  const playing = at <= n;
  const o = decisionOutcome(outcome, status, reserved);
  const replay = () => { stopFold(); setOpen(true); setRun((r) => r + 1); };

  return (
    <div className="@container">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {playing
          ? <span className="badge tone-neutral"><LoaderCircle size={12} className="spin" aria-hidden />Deciding</span>
          : <span className={`badge tone-${o.tone}`}><span className="tone-fill inline-block size-1.5 rounded-full" aria-hidden />{o.label}</span>}
        <p className="num min-w-0 flex-1 basis-40 text-sm text-ink-2" role="status">{playing ? `Check ${Math.min(at + 1, n)} of ${n}` : checksSummary(checks)}</p>
        <span className="flex shrink-0 flex-wrap gap-1">
          <button type="button" className="btn btn-quiet btn-sm" onClick={replay} disabled={playing && open}><Play size={12} aria-hidden />{replayLabel}</button>
          <button type="button" className="btn btn-quiet btn-sm" aria-expanded={open} onClick={() => { stopFold(); setOpen((v) => !v); }}>
            {open ? "Hide" : "Show checks"}<ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          </button>
        </span>
      </div>

      {open && (
        <div className="mt-3">
          <ol className="gap-x-6 border-y border-line py-1.5 @xl:columns-2" aria-label="Checks, in the order they ran">
            {checks.map((c, i) => {
              const done = i < at, active = i === at;
              const failed = done && !c.passed;
              return (
                <li key={`${c.rule}-${i}`} className={`flex break-inside-avoid items-start gap-2 py-1 text-sm transition-opacity duration-150 ${done || active ? "" : "opacity-45"}`}>
                  <span className="mt-0.5 shrink-0">
                    {!done ? (active ? <LoaderCircle size={15} className="spin text-ink-3" aria-hidden /> : <Circle size={15} className="text-ink-3" aria-hidden />)
                      : c.passed ? <CircleCheck size={15} className={`text-ok ${run ? "rise" : ""}`} aria-label="Passed" />
                        : <CircleX size={15} className={`text-bad ${run ? "rise" : ""}`} aria-label="Failed" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={failed ? "font-semibold text-bad-ink" : "text-ink"}>{checkLabel(c.rule)}</span>
                    {failed && <span className="block text-xs text-bad-ink [overflow-wrap:anywhere]">{c.detail}</span>}
                  </span>
                  <By by={c.enforcedBy} />
                </li>
              );
            })}
          </ol>
          <div className={`tone-${o.tone} tone-softbg mt-3 flex items-start gap-3 rounded-[10px] p-3.5 ${playing ? "invisible" : run ? "rise" : ""}`} aria-hidden={playing}>
            <span className="tone-mark mt-1 shrink-0">{o.icon}</span>
            <div className="min-w-0">
              <p className="display tone-text text-xl">{o.label}</p>
              <p className="tone-text mt-0.5 text-sm [overflow-wrap:anywhere]">{reason}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-ink-3">A check marked code is a fixed rule. A check marked model asks a model what the product is, and its answer can only narrow what is allowed.</p>
        </div>
      )}
    </div>
  );
}
