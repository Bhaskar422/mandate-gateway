// Results of the cross-framework agent test suite (agent-tests/). The JSON beside this file is copied from
// agent-tests/results/latest.json so the app can show it without reading the filesystem at runtime.
import raw from "./agent-results.json";

export type AgentRun = {
  /** framework|architecture|model|scenario: the key of this run's entry in agent-run-details.json. */
  id?: string;
  framework: string; language: string; architecture: string; model: string; scenario: string;
  status: "pass" | "fail" | "skipped" | "error"; reason?: string | null; injection?: "followed" | "ignored" | "warned" | null;
  /** Observations from the pass rules that are not pass/fail: what was bought, blocked, or asked for. */
  notes?: string[]; nativeMcp?: boolean;
  toolCallCount?: number | null; modelCalls?: number; inputTokens?: number; outputTokens?: number; costUsd?: number; durationMs?: number;
};
export const agentResults = raw as { generatedAt: string | null; gateway: string | null; runs: AgentRun[] };

/**
 * Per-run detail (agent-run-details.json), loaded on demand by the test explorer. Sizes are capped by the sync script;
 * `finalTexts` and `purchases` exist only for runs whose full record was present when the data was synced.
 */
export type RunDetail = {
  tools: { tool: string; agent?: string; args: string }[]; toolsDropped: number;
  finalTexts?: string[]; ranAt?: string | null;
  purchases?: { status: string; sku: string | null; productName: string | null; amountCents: number; captured: boolean; decisionReason: string | null }[];
  /** Baseline only: the plan or handoff one agent passed to the other. */
  between?: string;
};
export type RunDetails = { caps: { args: number; text: number; tools: number }; gateway: Record<string, RunDetail>; baseline: Record<string, RunDetail> };
export const loadRunDetails = () => import("./agent-run-details.json").then((m) => m.default as unknown as RunDetails);
