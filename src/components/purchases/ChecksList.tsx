import { Binary, BrainCircuit, CircleCheck, CircleX } from "lucide-react";
import type { PurchaseView } from "@/lib/views";
import { checkLabel } from "../format";
import LocalTime from "../LocalTime";

type Check = PurchaseView["checks"][number];

function EnforcedBy({ by }: { by: Check["enforcedBy"] }) {
  return by === "model"
    ? <span className="badge tone-dispute" title="A model read the product and answered this. Its answer can only narrow what is allowed."><BrainCircuit size={12} aria-hidden />Judged by a model</span>
    : <span className="badge tone-neutral" title="A fixed rule in code. No model output can change it."><Binary size={12} aria-hidden />Enforced by code</span>;
}

/** The engine writes timestamps as ISO strings; show them in the viewer's own time. */
function Detail({ text }: { text: string }) {
  return <>{text.split(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/).map((part, i) => (i % 2 ? <LocalTime key={i} iso={part} /> : part))}</>;
}

/** Every check the policy engine ran for one purchase, in the order it ran them. */
export default function ChecksList({ checks }: { checks: Check[] }) {
  const failed = checks.filter((c) => !c.passed).length;
  const byModel = checks.filter((c) => c.enforcedBy === "model").length;
  return (
    <div>
      <p className="text-sm text-ink-2">
        {checks.length - failed} of {checks.length} checks passed. {checks.length - byModel} are fixed rules in code{byModel > 0 && <>; {byModel} needed a model to say what the product is, and a model&apos;s answer can only narrow what is allowed, never raise a limit</>}.
      </p>
      <ol className="mt-3 divide-y divide-line border-y border-line">
        {checks.map((c, i) => (
          <li key={`${c.rule}-${i}`} className={`flex gap-3 py-2.5 ${c.passed ? "" : "tone-bad tone-softbg -mx-3 rounded-lg px-3"}`}>
            {c.passed
              ? <CircleCheck size={17} className="mt-0.5 shrink-0 text-ok" aria-label="Passed" />
              : <CircleX size={17} className="mt-0.5 shrink-0 text-bad" aria-label="Failed" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`text-base font-medium ${c.passed ? "text-ink" : "text-bad-ink"}`}>{checkLabel(c.rule)}</span>
                <EnforcedBy by={c.enforcedBy} />
              </div>
              <p className={`mt-0.5 text-sm [overflow-wrap:anywhere] ${c.passed ? "text-ink-3" : "text-bad-ink"}`}><Detail text={c.detail} /></p>
              <p className="code mt-0.5 text-[11px] text-ink-3">{c.rule}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
