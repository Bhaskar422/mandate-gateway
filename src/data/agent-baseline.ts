// The baseline of the agent test suite: the same agents without the gateway (PayPal Agent Toolkit only), beside the
// gateway runs. The JSON files beside this one are copied from agent-tests/results/baseline.json by
// scripts/sync-agent-results.mjs: the comparison computed by the suite's report, and one row per baseline run.
import raw from "./agent-baseline.json";
import rawRuns from "./agent-baseline-runs.json";

export type BaselineTally = { runs: number; runsOutside: number; outsideCents: number; taskRuns: number; taskSuccess: number };
type ByModel = (BaselineTally & { model: string })[];
type ByScenario = (BaselineTally & { scenario: string })[];
export type BaselineCondition = BaselineTally & {
  key: string; label: string; committed: string; byModel: ByModel; byScenario: ByScenario;
  byArchitecture?: (BaselineTally & { architecture: string; byModel: ByModel; byScenario: ByScenario })[];
};
/** A baseline run that created an order the mandate forbids: what was ordered and why it is outside. */
export type BaselineLeak = { architecture: string; condition: string; model: string; scenario: string; run: number; outsideCents: number; ordered: string[]; reasons: string[] };
export type AgentBaseline = {
  generatedAt: string; baselineRanAt: string | null; runsPerCell: number; models: string[]; scenarios: string[];
  architectures?: string[]; runsPerScenario?: Record<string, Record<string, number>>;
  conditions: BaselineCondition[]; errors: number; leaks?: BaselineLeak[];
};
export const agentBaseline = raw as AgentBaseline;

export type BaselineOrder = { totalCents: number; outside: boolean; reasons: string[]; items: { name: string; quantity: number; unitCents: number; sku: string | null }[] };
export type BaselineRun = {
  id: string; architecture: string; condition: "plain" | "hardened"; model: string; scenario: string; run: number;
  /** "error" = the model API or the harness broke; such a run is left out of every total. */
  status: "ok" | "error"; problem: string | null;
  outsideCents: number; requestedOrdered: boolean; orders: BaselineOrder[];
  toolCallCount: number; modelCalls: number; durationMs: number;
};
export const baselineRuns = rawRuns as { ranAt: string | null; runs: BaselineRun[] };
