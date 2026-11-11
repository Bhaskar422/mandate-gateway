// The baseline comparison of the agent test suite: the same agents without the gateway (PayPal Agent Toolkit only)
// beside the gateway runs. The JSON beside this file is copied from agent-tests/results/baseline.json by
// scripts/sync-agent-results.mjs.
import raw from "./agent-baseline.json";

export type BaselineTally = { runs: number; runsOutside: number; outsideCents: number; taskRuns: number; taskSuccess: number };
export type BaselineCondition = BaselineTally & {
  key: string; label: string; committed: string;
  byModel: (BaselineTally & { model: string })[]; byScenario: (BaselineTally & { scenario: string })[];
};
export type AgentBaseline = {
  generatedAt: string; baselineRanAt: string | null; runsPerCell: number; models: string[]; scenarios: string[];
  conditions: BaselineCondition[]; errors: number;
};
export const agentBaseline = raw as AgentBaseline;
