// Framework 2: the Claude Agent SDK, connected to the gateway and the stores through its native remote-MCP
// client (three Streamable HTTP servers). No tool wrappers of ours are involved: this proves MCP interop.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query, type AgentDefinition, type McpHttpServerConfig, type Options, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { PROMPTS } from "../harness/scenarios";
import { canonicalToolCall, mcpUrls } from "../harness/tools";
import { StepLimitError, type AgentContext, type AgentSession, type Framework } from "../harness/types";

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

/** The SDK runs Claude Code as a subprocess. Do not let it inherit this machine's Claude Code session or proxy. */
function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || /^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_|ANTHROPIC_BASE_URL$|ANTHROPIC_AUTH_TOKEN$)/.test(k)) continue;
    env[k] = v;
  }
  env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = "1"; // a turn must not end while a subagent is still working
  return env;
}

/** A long-lived query() fed one user message per turn (streaming input), so the conversation persists without session files. */
class Conversation {
  private inbox: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  private q: Query;
  private it: AsyncIterator<unknown>;
  private seenMessageIds = new Set<string>();
  private usageSoFar = { input: 0, output: 0, cost: 0 };

  constructor(private ctx: AgentContext, options: Options) {
    const self = this;
    async function* input(): AsyncGenerator<SDKUserMessage> {
      for (;;) {
        while (!self.inbox.length && !self.closed) await new Promise<void>((r) => { self.wake = r; });
        if (self.closed) return;
        yield self.inbox.shift()!;
      }
    }
    this.q = query({ prompt: input(), options });
    this.it = this.q[Symbol.asyncIterator]();
  }

  async send(text: string): Promise<string> {
    this.inbox.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
    this.wake?.();
    const signal = this.ctx.signal();
    const onAbort = () => { void this.q.interrupt().catch(() => {}); };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      for (;;) {
        const { value, done } = await this.it.next();
        if (done) throw new Error("the Claude Agent SDK session ended before the turn finished");
        const m = value as { type: string; subtype?: string; message?: { id?: string; content?: unknown[] }; parent_tool_use_id?: string | null;
          result?: string; total_cost_usd?: number; modelUsage?: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>; errors?: string[] };
        if (process.env.AGENT_TESTS_DEBUG) console.error("[agent-sdk]", JSON.stringify(m).slice(0, 1200));
        if (m.type === "assistant" && m.message) {
          if (m.message.id && !this.seenMessageIds.has(m.message.id)) { this.seenMessageIds.add(m.message.id); this.ctx.recorder.modelCalls++; }
          for (const b of (m.message.content ?? []) as { type: string; name?: string; input?: Record<string, unknown> }[]) {
            if (b.type !== "tool_use" || !b.name) continue;
            const c = canonicalToolCall(b.name, b.input ?? {});
            this.ctx.recorder.tool(c.tool, c.args, m.parent_tool_use_id ? "subagent" : "agent");
          }
        }
        if (m.type === "result") {
          // modelUsage and total_cost_usd are cumulative for the session: record the increase since the last turn.
          const mu = Object.values(m.modelUsage ?? {});
          const input = mu.reduce((s, u) => s + u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, 0), output = mu.reduce((s, u) => s + u.outputTokens, 0);
          this.ctx.recorder.inputTokens += input - this.usageSoFar.input; this.ctx.recorder.outputTokens += output - this.usageSoFar.output;
          this.ctx.recorder.reportedCostUsd = (this.ctx.recorder.reportedCostUsd ?? 0) + ((m.total_cost_usd ?? 0) - this.usageSoFar.cost);
          this.usageSoFar = { input, output, cost: m.total_cost_usd ?? 0 };
          if (m.subtype === "error_max_turns") throw new StepLimitError(this.ctx.maxSteps);
          if (m.subtype !== "success") throw new Error(`Claude Agent SDK result ${m.subtype}: ${(m.errors ?? []).join("; ").slice(0, 300)}`);
          return (m.result ?? "").trim();
        }
      }
    } finally { signal.removeEventListener("abort", onAbort); }
  }

  async close() { this.closed = true; this.wake?.(); try { this.q.close(); } catch { /* already closed */ } }
}

async function create(ctx: AgentContext): Promise<AgentSession> {
  const urls = mcpUrls(ctx.gatewayUrl);
  const http = (url: string, key?: string): McpHttpServerConfig => ({ type: "http", url, ...(key ? { headers: { Authorization: `Bearer ${key}` } } : {}) });
  const stores = { stride: http(urls.stride), kickz: http(urls.kickz) };
  const gateway = { mandate: http(urls.gateway, ctx.agentKey) };
  const base: Options = {
    model: ctx.model, cwd: mkdtempSync(join(tmpdir(), "agent-tests-")), env: childEnv(),
    settingSources: [], strictMcpConfig: true, persistSession: false, maxTurns: ctx.maxSteps,
    tools: [], permissionMode: "dontAsk", forwardSubagentText: false,
  };
  const withMcp = (servers: Record<string, McpHttpServerConfig>): Partial<Options> =>
    ({ mcpServers: servers, allowedTools: Object.keys(servers).map((s) => `mcp__${s}`) });

  if (ctx.architecture === "single") {
    const c = new Conversation(ctx, { ...base, systemPrompt: PROMPTS.system, ...withMcp({ ...stores, ...gateway }) });
    return { send: (u) => c.send(u), close: () => c.close() };
  }

  if (ctx.architecture === "planner_executor") {
    const planner = new Conversation(ctx, { ...base, systemPrompt: PROMPTS.planner });
    const executor = new Conversation(ctx, { ...base, systemPrompt: `${PROMPTS.system}\n\n${PROMPTS.executor_suffix}`, ...withMcp({ ...stores, ...gateway }) });
    return {
      async send(user) { const plan = await planner.send(user); return executor.send(fill(PROMPTS.executor_turn, { user, plan })); },
      async close() { await planner.close(); await executor.close(); },
    };
  }

  // multi_agent: the SDK's own subagents. The main agent has only the Agent tool; each subagent has only its own MCP servers.
  const agents: Record<string, AgentDefinition> = {
    shopper: { description: "Finds products in the Stride Running Co. and Kickz Outlet catalogues. Cannot pay.", prompt: PROMPTS.shopper, model: "inherit",
      mcpServers: [{ stride: stores.stride }, { kickz: stores.kickz }], tools: ["stride", "kickz"].flatMap((s) => [`mcp__${s}__search_products`, `mcp__${s}__get_product`]) },
    buyer: { description: "Pays for a product through the Mandate payment gateway, checks purchases and reports problems. Cannot see store catalogues.", prompt: PROMPTS.buyer, model: "inherit",
      mcpServers: [gateway], tools: ["get_mandate", "request_purchase", "check_status", "report_problem"].map((t) => `mcp__mandate__${t}`) },
  };
  const c = new Conversation(ctx, { ...base, systemPrompt: PROMPTS.orchestrator, agents, tools: ["Agent"], allowedTools: ["Agent", "mcp__stride", "mcp__kickz", "mcp__mandate"] });
  return { send: (u) => c.send(u), close: () => c.close() };
}

export const claudeAgentSdk: Framework = {
  name: "claude-agent-sdk", architectures: ["single", "planner_executor", "multi_agent"], nativeMcp: true,
  requiresEnv: "ANTHROPIC_API_KEY", provider: "anthropic", create,
};
