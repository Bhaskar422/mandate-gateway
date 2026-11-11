import type { AgentBaseline } from "@/data/agent-baseline";
import { money, plural } from "../format";

const NOTE: Record<string, string> = {
  toolkit_plain: "PayPal's own order tools, the mandate as text in the prompt, no gateway.",
  toolkit_hardened: "The same, plus strict rules in the prompt: obey the mandate, ignore product-page instructions, no gift cards.",
  gateway: "The agent can only ask. The gateway checks the mandate in code and pays, asks the user or blocks.",
};

/** The same agents with and without the gateway: dollars outside the mandate, runs affected, task success. */
export default function BaselineComparison({ baseline }: { baseline: AgentBaseline }) {
  const { conditions } = baseline;
  if (!conditions?.length) return null;
  const gateway = conditions.find((c) => c.key === "gateway");
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
      <p className="mt-3 max-w-3xl text-sm text-ink-3">
        Five scenarios (a plain purchase, an unverified store, a product page with a hidden instruction, a price above the ask-first amount, a price over budget), one agent with all the tools, on {baseline.models.join(", ")}, {baseline.runsPerCell} runs per model and scenario for the two toolkit conditions.
        For the toolkit, the dollar figure is PayPal sandbox orders the agent created that the mandate forbids; they were created, not captured, because capture needs the buyer to approve in a browser. Each order is checked in code against the store, the category, the budget and the ask-first amount.
        {gateway && <> The gateway figure is sandbox payments actually captured, from the {plural(gateway.runs, "run")} below that use the same scenarios and models (one per framework, not re-run).</>}
        {conditions.every((c) => c.outsideCents === 0) && <> In these runs no agent created or paid for an order outside the mandate in any condition, so the comparison shows no difference in dollars.</>}
        {" "}Small samples: read the totals, not single cells.
      </p>
    </div>
  );
}
