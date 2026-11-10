export type Architecture = "single" | "planner_executor" | "multi_agent";
export const ARCHITECTURES: Architecture[] = ["single", "planner_executor", "multi_agent"];

export type ToolCall = { tool: string; args: Record<string, unknown>; agent?: string };
export type RunStatus = "pass" | "fail" | "skipped" | "error";
export type Injection = "followed" | "ignored" | "warned" | null;

/** One row of results/latest.json. */
export type RunRecord = {
  framework: string; language: "ts" | "py"; architecture: Architecture; model: string; scenario: string;
  status: RunStatus; reason: string; injection: Injection;
  toolCalls: ToolCall[]; modelCalls: number; inputTokens: number; outputTokens: number; costUsd: number; durationMs: number;
  /** Extra detail kept for debugging; not part of the required schema. */
  finalTexts?: string[]; purchases?: unknown[]; notes?: string[]; nativeMcp?: boolean; ranAt?: string;
};

/** Collects what an agent did. Shared by every framework adapter. */
export class Recorder {
  toolCalls: ToolCall[] = [];
  modelCalls = 0; inputTokens = 0; outputTokens = 0;
  /** Set when the framework reports its own cost (Claude Agent SDK); otherwise cost is computed from tokens. */
  reportedCostUsd: number | null = null;
  tool(tool: string, args: unknown, agent?: string) {
    this.toolCalls.push({ tool, args: (args && typeof args === "object" ? args : {}) as Record<string, unknown>, ...(agent ? { agent } : {}) });
  }
  usage(inputTokens: number | undefined | null, outputTokens: number | undefined | null, calls = 1) {
    this.modelCalls += calls; this.inputTokens += inputTokens ?? 0; this.outputTokens += outputTokens ?? 0;
  }
}

export type AgentContext = {
  architecture: Architecture; model: string;
  gatewayUrl: string; agentKey: string;
  recorder: Recorder;
  /** Hard cap on model/tool steps per user turn. */
  maxSteps: number;
  /** Aborted when the turn's wall-clock budget runs out. */
  signal: () => AbortSignal;
};

export interface AgentSession {
  /** One user turn. Returns the agent's final text for that turn. Conversation state persists across calls. */
  send(userText: string): Promise<string>;
  close?(): Promise<void>;
}

export type Framework = {
  name: string;
  architectures: Architecture[];
  /** Why an architecture is not implemented for this framework. */
  skipped?: Partial<Record<Architecture, string>>;
  /** True when the agent reaches the tools through the framework's own MCP client. */
  nativeMcp: boolean;
  /** Environment variable that must be set, else every run is "skipped". */
  requiresEnv: string;
  /** Model families this framework can drive. */
  provider: "anthropic" | "openai" | "google";
  create(ctx: AgentContext): Promise<AgentSession>;
};

export class StepLimitError extends Error {
  constructor(max: number) { super(`step limit reached (${max} steps in one turn)`); }
}
