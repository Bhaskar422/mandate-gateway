import type { Metadata } from "next";
import Link from "next/link";
import BaselineComparison from "@/components/public/BaselineComparison";
import { BaselineRuns, GatewayRuns } from "@/components/public/TestExplorer";
import PublicShell from "@/components/shell/PublicShell";
import LocalTime from "@/components/LocalTime";
import { agentBaseline, baselineRuns } from "@/data/agent-baseline";
import { agentResults } from "@/data/agent-results";
import { HARNESS_STEP, scenarioLimits, scenarios } from "@/data/agent-scenarios";

export const metadata: Metadata = { title: "Agent test runs" };

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="display scroll-mt-6 text-2xl text-ink">{children}</h2>;
}

/** Public: every run of the agent test suite, one row each, with what the agent did. */
export default function AgentTestsPage() {
  const { runs } = agentResults;
  const order = scenarios.map((s) => s.name);
  const frameworks = new Set(runs.map((r) => r.framework)).size, architectures = new Set(runs.map((r) => r.architecture)).size, models = [...new Set(runs.map((r) => r.model))];
  const toc = [["baseline", "With and without the gateway"], ["scenarios", "The scenarios"], ["runs", "Gateway runs"], ["baseline-runs", "Baseline runs"]];
  return (
    <PublicShell width="max-w-[1040px]">
      <header className="mb-8 max-w-3xl">
        <p className="eyebrow"><Link href="/developers" className="link">Developers</Link> · Agent tests</p>
        <h1 className="display mt-1 text-3xl text-ink">Every test run, and what the agent did in it</h1>
        <p className="mt-2 text-lg text-ink-2">
          {runs.length} runs of real shopping agents against this gateway: {frameworks} agent frameworks, {architectures} architectures, {models.length} models, {order.length} scenarios.
          Each run is judged from the gateway&apos;s own purchase records, never from what the model says it did.
        </p>
        <nav aria-label="On this page" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">{toc.map(([id, label]) => <a key={id} href={`#${id}`} className="link">{label}</a>)}</nav>
      </header>

      <div className="space-y-12">
        <section aria-labelledby="baseline" className="space-y-4">
          <H2 id="baseline">With and without the gateway</H2>
          <BaselineComparison baseline={agentBaseline} />
        </section>

        <section aria-labelledby="scenarios" className="space-y-4">
          <H2 id="scenarios">The scenarios</H2>
          <p className="max-w-3xl text-base text-ink-2">
            Every agent starts as a fresh user with a PayPal sandbox wallet, one agent key and one mandate. The stores sell each product as listed, so there is nothing to ask the user about.
            An agent may take at most {scenarioLimits.maxStepsPerTurn} model or tool steps and {scenarioLimits.turnTimeoutMs / 1000} seconds per user message; hitting either cap is a fail.
            A fail means the agent ran and the gateway&apos;s records do not match the rule. An error means the framework or the harness broke.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {scenarios.map((s) => (
              <article key={s.name} className="card p-4">
                <p className="eyebrow">{s.name.replace(/_/g, " ")}</p>
                <h3 className="mt-0.5 text-base font-semibold text-ink">{s.title}</h3>
                <dl className="mt-2 space-y-2 text-sm">
                  <div>
                    <dt className="font-semibold text-ink-2">The mandate</dt>
                    <dd className="text-ink-2">“{s.mandate}”</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink-2">What the user says</dt>
                    <dd>
                      <ol className="space-y-0.5">
                        {s.steps.map((st, i) => st.type === "user"
                          ? <li key={i} className="text-ink">“{st.text}”</li>
                          : <li key={i} className="text-ink-3">{HARNESS_STEP[st.action] ?? `Harness step: ${st.action.replace(/_/g, " ")}.`}</li>)}
                      </ol>
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink-2">The right outcome</dt>
                    <dd className="text-ink-2">{s.right}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink-2">Passes when</dt>
                    <dd className="text-ink-2">{s.pass}</dd>
                  </div>
                  {s.baseline && (
                    <div>
                      <dt className="font-semibold text-ink-2">In the baseline</dt>
                      <dd className="text-ink-3">{s.baseline}</dd>
                    </div>
                  )}
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="runs" className="space-y-4">
          <H2 id="runs">Gateway runs</H2>
          <p className="max-w-3xl text-base text-ink-2">
            One row per run. Failures come first, then runs where the agent followed the hidden instruction, then the rest in the suite&apos;s order. Open a row for the tool calls in order, the gateway&apos;s purchase records and the agent&apos;s final message.
            Tool arguments and messages are shortened. The hidden-instruction label is a keyword check on the final message, so read the message before quoting it.
            {agentResults.generatedAt && <> Report built <LocalTime iso={agentResults.generatedAt} />.</>}
          </p>
          <GatewayRuns runs={runs} scenarioOrder={order} />
        </section>

        <section aria-labelledby="baseline-runs" className="space-y-4">
          <H2 id="baseline-runs">Baseline runs: the same agents without the gateway</H2>
          <p className="max-w-3xl text-base text-ink-2">
            Here the agent pays with the order tools of PayPal&apos;s Agent Toolkit against the PayPal sandbox, and the mandate is only text in its prompt. Each run is one user message.
            Every order the agent created is read back from PayPal and checked in code against the mandate. Orders are created, not captured: no money moved. Runs with an order outside the mandate come first.
            {baselineRuns.ranAt && <> Last run <LocalTime iso={baselineRuns.ranAt} />.</>}
          </p>
          <BaselineRuns runs={baselineRuns.runs} scenarioOrder={order} />
        </section>
      </div>
    </PublicShell>
  );
}
