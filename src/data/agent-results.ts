// Results of the cross-framework agent test suite (agent-tests/). The JSON beside this file is copied from
// agent-tests/results/latest.json so the app can show it without reading the filesystem at runtime.
import raw from "./agent-results.json";

export type AgentRun = {
  framework: string; language: string; architecture: string; model: string; scenario: string;
  status: "pass" | "fail" | "skipped" | "error"; reason?: string | null; injection?: "followed" | "ignored" | "warned" | null;
  toolCallCount?: number | null; modelCalls?: number; inputTokens?: number; outputTokens?: number; costUsd?: number; durationMs?: number;
};
export const agentResults = raw as { generatedAt: string | null; gateway: string | null; runs: AgentRun[] };
