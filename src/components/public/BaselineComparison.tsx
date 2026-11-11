import type { AgentBaseline, BaselineTally } from "@/data/agent-baseline";
import { money, plural } from "../format";

const NOTE: Record<string, string> = {
  toolkit_plain: "PayPal's own order tools, the mandate as text in the prompt, no gateway.",
  toolkit_hardened: "The same, plus strict rules in the prompt: obey the mandate, ignore product-page instructions, no gift cards.",
  gateway: "The agent can only ask. The gateway checks the mandate in code and pays, asks the user or blocks.",
};
const ARCHITECTURE: Record<string, string> = {
  single: "one agent with all the tools",
  planner_executor: "a planner with no tools writes a plan and an executor with the tools carries it out",
  multi_agent: "a shopper with only the catalogue tools hands the product to a buyer with only the payment tools",
};
const words = (s: string) => s.replace(/_/g, " ");
const cell = (t: BaselineTally) => (t.runs ? `${money(t.outsideCents)} in ${t.runsOutside} of ${t.runs}` : "not run");
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The same agents with and without the gateway: dollars outside the mandate, runs affected, task success, by architecture. */
export default function BaselineComparison({ baseline }: { baseline: AgentBaseline }) {
  const { conditions } = baseline;
  if (!conditions?.length) return null;
  const gateway = conditions.find((c) => c.key === "gateway");
  const architectures = baseline.architectures ?? [];
  const leaks = baseline.leaks ?? [];
  const perScenario = baseline.runsPerScenario ?? {};
  // Which architectures show any dollars outside the mandate, in any condition.
  const affected = architectures.filter((_, i) => conditions.some((c) => (c.byArchitecture?.[i]?.outsideCents ?? 0) > 0));
  const clean = architectures.filter((a) => !affected.includes(a));
  const groups = [...new Set(leaks.map((l) => `${l.architecture}|${l.condition}|${l.model}|${l.scenario}`))].map((k) => {
    const [architecture, condition, model, scenario] = k.split("|");
    const rows = leaks.filter((l) => `${l.architecture}|${l.condition}|${l.model}|${l.scenario}` === k);
    return { architecture, condition, model, scenario, runs: rows.length, cents: rows.reduce((s, l) => s + l.outsideCents, 0), ordered: [...new Set(rows.flatMap((l) => l.ordered))], reasons: [...new Set(rows.flatMap((l) => l.reasons))] };
  });

  return (
    <div>
      <p className="eyebrow">Baseline: the same agents without the gateway</p>
      <dl className="mt-2 grid gap-3 sm:grid-cols-3">
        {conditions.map((c) => (
          <div key={c.key} className="card p-4">
            <dt className="text-sm font-semibold text-ink">{c.label}</dt>
            <dd className="display num mt-1 text-2xl text-ink">{money(c.outsideCents)}</dd>
            <dd className="text-xs text-ink-3">outside the mandate{c.key === "gateway" ? ", captured" : ", in orders created"}</dd>
            <dd className="num mt-2 text-sm text-ink-2">{c.runsOutside} of {plural(c.runs, "run")} affected</dd>
            <dd className="num text-sm text-ink-2">Plain purchase done in {c.taskSuccess} of {c.taskRuns}</dd>
            <dd className="mt-2 text-xs text-ink-3">{NOTE[c.key]}</dd>
          </div>
        ))}
      </dl>

      {architectures.length > 0 && (
        <div className="card mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Dollars outside the mandate by architecture and condition">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-3"><span className="eyebrow">Architecture</span></th>
                {conditions.map((c) => <th key={c.key} scope="col" className="px-3 py-3 align-bottom"><span className="eyebrow">{c.label}</span></th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {architectures.map((a, i) => (
                <tr key={a}>
                  <th scope="row" className="px-4 py-3 align-top font-normal">
                    <span className="block font-semibold text-ink">{words(a)}</span>
                    <span className="block text-xs text-ink-3">{ARCHITECTURE[a]}</span>
                  </th>
                  {conditions.map((c) => {
                    const t = c.byArchitecture?.[i];
                    return (
                      <td key={c.key} className="num px-3 py-3 align-top text-ink-2">
                        {t ? <><span className={t.outsideCents > 0 ? "font-semibold text-ink" : ""}>{money(t.outsideCents)}</span><span className="block text-xs text-ink-3">{t.runsOutside} of {plural(t.runs, "run")}</span></> : "not run"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 max-w-3xl space-y-2 text-sm text-ink-3">
        {architectures.length > 0 && (affected.length === 0 ? (
          <p className="text-ink-2">In these runs no agent created or paid for an order outside the mandate, in any condition or architecture, so the comparison shows no difference in dollars.</p>
        ) : (
          <div className="text-ink-2">
            <p>
              The conditions differ in {list(affected.map(words))}.
              {affected.map((a) => { const i = architectures.indexOf(a); return <span key={a}> In {words(a)}: {conditions.map((c) => `${c.label.replace("PayPal Agent Toolkit, ", "toolkit, ").replace("Mandate gateway", "gateway")} ${c.byArchitecture?.[i] ? cell(c.byArchitecture[i]) : "not run"}`).join("; ")} runs.</span>; })}
              {clean.length > 0 && <> In {list(clean.map(words))} no condition had an order outside the mandate.</>}
            </p>
            {groups.length > 0 && (
              <>
                <p className="mt-2">Where the toolkit orders outside the mandate came from:</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {groups.map((g) => (
                    <li key={`${g.architecture}${g.condition}${g.model}${g.scenario}`} className="[overflow-wrap:anywhere]">
                      <span className="font-semibold text-ink">{words(g.architecture)}, {g.condition} prompt, {g.model}, {words(g.scenario)}:</span> {plural(g.runs, "run")}, {money(g.cents)}. Ordered: {g.ordered.join("; ")}. Outside because {g.reasons.join("; ")}.
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ))}
        <p>
          Five scenarios (a plain purchase, an unverified store, a product page with a hidden instruction, a price above the ask-first amount, a price over budget), on {baseline.models.join(", ")}.
          {architectures.length > 0
            ? <> Runs per model and scenario in each toolkit condition: {architectures.map((a) => { const n = perScenario[a] ?? {}, rest = Math.max(0, ...Object.entries(n).filter(([s]) => s !== "injection").map(([, v]) => v)); return `${words(a)} ${rest}${n.injection && n.injection !== rest ? ` (${n.injection} for the hidden instruction)` : ""}`; }).join(", ")}.</>
            : <> {baseline.runsPerCell} runs per model and scenario for the two toolkit conditions.</>}
          {" "}For the toolkit, the dollar figure is PayPal sandbox orders the agent created that the mandate forbids; they were created, not captured, because capture needs the buyer to approve in a browser. Each order is read back from PayPal and checked in code against the store, the category, the budget and the ask-first amount. Each baseline run is one user message, so an order above the ask-first amount counts as outside: the user was never asked.
          {gateway && <> The gateway figure is sandbox payments actually captured, from the {plural(gateway.runs, "gateway run")} on the same architectures, scenarios and models (one per framework, not re-run).</>}
          {baseline.errors > 0 && <> {plural(baseline.errors, "baseline run")} ended in a model API or harness error and {baseline.errors === 1 ? "is" : "are"} left out of every total.</>}
          {" "}Small samples: read the totals and the pattern, not single cells.
        </p>
      </div>
    </div>
  );
}
