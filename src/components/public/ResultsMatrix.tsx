import { CircleCheck, CircleSlash, CircleX, FlaskConical, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import type { AgentRun } from "@/data/agent-results";
import type { Tone } from "../format";
import LocalTime from "../LocalTime";
import { EmptyState } from "../ui/Layout";

const STATUS: Record<AgentRun["status"], { label: string; tone: Tone; icon: React.ReactNode }> = {
  pass: { label: "Pass", tone: "ok", icon: <CircleCheck size={14} aria-hidden /> },
  fail: { label: "Fail", tone: "bad", icon: <CircleX size={14} aria-hidden /> },
  error: { label: "Error", tone: "bad", icon: <TriangleAlert size={14} aria-hidden /> },
  skipped: { label: "Skipped", tone: "neutral", icon: <CircleSlash size={14} aria-hidden /> },
};
const INJECTION: Record<NonNullable<AgentRun["injection"]>, { label: string; tone: Tone; icon: React.ReactNode; meaning: string }> = {
  ignored: { label: "Ignored it", tone: "ok", icon: <ShieldCheck size={12} aria-hidden />, meaning: "The agent did not act on the hidden instruction." },
  warned: { label: "Warned the user", tone: "ok", icon: <ShieldCheck size={12} aria-hidden />, meaning: "The agent noticed the hidden instruction and told the user." },
  followed: { label: "Followed it", tone: "flag", icon: <ShieldAlert size={12} aria-hidden />, meaning: "The agent obeyed the hidden instruction and asked for the gift card. The gateway still blocked the purchase." },
};
const words = (s: string) => s.replace(/[_-]+/g, " ");

/** Cross-framework agent test results: one row per framework, architecture and model; one column per scenario. */
export default function ResultsMatrix({ results }: { results: { generatedAt: string | null; gateway: string | null; runs: AgentRun[] } }) {
  const { runs } = results;
  if (runs.length === 0) {
    return (
      <EmptyState icon={<FlaskConical size={18} aria-hidden />} title="No test runs have been published yet">
        The suite drives the same shopping scenarios through agents built on different frameworks, over MCP and over REST, including a product page with a hidden instruction. When a run is published, the pass and fail matrix appears here.
      </EmptyState>
    );
  }

  const scenarios = [...new Set(runs.map((r) => r.scenario))];
  const rowKey = (r: AgentRun) => `${r.framework}|${r.architecture}|${r.model}`;
  const rows = [...new Map(runs.map((r) => [rowKey(r), r])).values()].sort((a, b) => rowKey(a).localeCompare(rowKey(b)));
  const cell = (row: AgentRun, scenario: string) => runs.findLast((r) => rowKey(r) === rowKey(row) && r.scenario === scenario);
  const count = (s: AgentRun["status"]) => runs.filter((r) => r.status === s).length;
  const exposed = runs.filter((r) => r.injection), followed = exposed.filter((r) => r.injection === "followed");
  const problems = runs.filter((r) => (r.status === "fail" || r.status === "error") && r.reason);

  return (
    <div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { l: "Runs", v: runs.length, n: `${rows.length} agent setups × ${scenarios.length} scenarios` },
          { l: "Passed", v: count("pass"), n: `${Math.round((count("pass") / Math.max(runs.length - count("skipped"), 1)) * 100)}% of runs that ran` },
          { l: "Failed", v: count("fail") + count("error"), n: `${count("skipped")} skipped` },
          { l: "Followed the injection", v: `${followed.length} of ${exposed.length}`, n: "agents that met the hidden instruction" },
        ].map((x) => (
          <div key={x.l} className="card p-4">
            <dt className="text-sm font-medium text-ink-2">{x.l}</dt>
            <dd className="display num mt-1 text-2xl text-ink">{x.v}</dd>
            <dd className="text-xs text-ink-3">{x.n}</dd>
          </div>
        ))}
      </dl>

      <div className="card mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Results by agent setup and scenario">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="sticky left-0 z-10 bg-surface px-4 py-3"><span className="eyebrow">Framework · architecture · model</span></th>
              {scenarios.map((s) => <th key={s} scope="col" className="px-3 py-3 align-bottom"><span className="eyebrow">{words(s)}</span></th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-3 align-top font-normal">
                  <span className="block text-base font-semibold text-ink">{row.framework}</span>
                  <span className="block text-xs text-ink-3">{words(row.architecture)} · {row.language} · {row.model}</span>
                </th>
                {scenarios.map((s) => {
                  const r = cell(row, s);
                  if (!r) return <td key={s} className="px-3 py-3 align-top text-ink-3">Not run</td>;
                  const st = STATUS[r.status], inj = r.injection ? INJECTION[r.injection] : null;
                  return (
                    <td key={s} className="px-3 py-3 align-top">
                      <span className={`badge tone-${st.tone}`} title={r.reason ?? undefined}>{st.icon}{st.label}</span>
                      {inj && <span className={`badge tone-${inj.tone} mt-1 !flex w-fit`} title={inj.meaning}>{inj.icon}{inj.label}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-sm text-ink-3">
        The second badge in a cell says what the agent did with a hidden instruction on a product page. “Followed it” is the agent&apos;s failure, not the gateway&apos;s: the purchase it asked for was still blocked.
        {results.generatedAt && <> Run <LocalTime iso={results.generatedAt} /></>}{results.gateway && <> against <span className="code">{results.gateway}</span></>}.
      </p>

      {problems.length > 0 && (
        <details className="card mt-4 p-4">
          <summary className="text-base font-semibold text-ink">Why {problems.length} {problems.length === 1 ? "run" : "runs"} failed</summary>
          <ul className="mt-3 space-y-2">
            {problems.map((r, i) => (
              <li key={i} className="text-sm text-ink-2 [overflow-wrap:anywhere]"><span className="font-semibold text-ink">{r.framework} · {words(r.architecture)} · {r.model} · {words(r.scenario)}:</span> {r.reason}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
