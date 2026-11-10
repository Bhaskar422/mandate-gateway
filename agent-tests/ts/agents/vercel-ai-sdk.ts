// Framework 3: the Vercel AI SDK (ai v7) with the Anthropic provider. The six tools are native AI SDK tools.
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, isStepCount, tool, type ModelMessage, type ToolSet } from "ai";
import { PROMPTS } from "../harness/scenarios";
import { toolsFor, type ToolGroup } from "../harness/tools";
import { StepLimitError, type AgentContext, type AgentSession, type Framework } from "../harness/types";

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

async function create(ctx: AgentContext): Promise<AgentSession> {
  const model = anthropic(ctx.model);
  let stepsLeft = ctx.maxSteps;

  const toolSet = (agent: string, ...groups: ToolGroup[]): ToolSet => Object.fromEntries(toolsFor(...groups).map((t) => [t.name, tool({
    description: t.description, inputSchema: t.schema,
    execute: (input: Record<string, unknown>) => t.run(input, { gatewayUrl: ctx.gatewayUrl, agentKey: ctx.agentKey, recorder: ctx.recorder, agent, signal: ctx.signal() }),
  })]));

  /** One agent, run to completion with the AI SDK's own multi-step loop. `messages` keeps the agent's history. */
  async function run(instructions: string, messages: ModelMessage[], tools: ToolSet): Promise<string> {
    if (stepsLeft <= 0) throw new StepLimitError(ctx.maxSteps);
    const hasTools = Object.keys(tools).length > 0;
    const r = await generateText({
      model, instructions, messages, maxOutputTokens: 8000, abortSignal: ctx.signal(), maxRetries: 2,
      ...(hasTools ? { tools, toolChoice: "auto" as const, stopWhen: isStepCount(stepsLeft) } : {}),
    });
    stepsLeft -= r.steps.length;
    ctx.recorder.usage(r.usage.inputTokens, r.usage.outputTokens, r.steps.length);
    messages.push(...r.responseMessages);
    if (r.finishReason === "tool-calls") throw new StepLimitError(ctx.maxSteps);
    return r.text.trim();
  }

  if (ctx.architecture === "single") {
    const messages: ModelMessage[] = [], tools = toolSet("agent", "store", "gateway");
    return { async send(user) { stepsLeft = ctx.maxSteps; messages.push({ role: "user", content: user }); return run(PROMPTS.system, messages, tools); } };
  }

  if (ctx.architecture === "planner_executor") {
    const plannerMessages: ModelMessage[] = [], executorMessages: ModelMessage[] = [], tools = toolSet("executor", "store", "gateway");
    return {
      async send(user) {
        stepsLeft = ctx.maxSteps;
        plannerMessages.push({ role: "user", content: user });
        const plan = await run(PROMPTS.planner, plannerMessages, {});
        executorMessages.push({ role: "user", content: fill(PROMPTS.executor_turn, { user, plan }) });
        return run(`${PROMPTS.system}\n\n${PROMPTS.executor_suffix}`, executorMessages, tools);
      },
    };
  }

  // multi_agent: shopper (catalogue tools) hands off to buyer (gateway tools); the buyer takes follow-up turns.
  const shopperMessages: ModelMessage[] = [], buyerMessages: ModelMessage[] = [];
  const shopperTools = toolSet("shopper", "store"), buyerTools = toolSet("buyer", "gateway");
  let handedOff = false;
  return {
    async send(user) {
      stepsLeft = ctx.maxSteps;
      if (handedOff) { buyerMessages.push({ role: "user", content: user }); return run(PROMPTS.buyer, buyerMessages, buyerTools); }
      shopperMessages.push({ role: "user", content: user });
      const handoff = await run(PROMPTS.shopper, shopperMessages, shopperTools);
      handedOff = true;
      buyerMessages.push({ role: "user", content: fill(PROMPTS.buyer_turn, { user, handoff }) });
      return run(PROMPTS.buyer, buyerMessages, buyerTools);
    },
  };
}

export const vercelAiSdk: Framework = {
  name: "vercel-ai-sdk", architectures: ["single", "planner_executor", "multi_agent"], nativeMcp: false,
  requiresEnv: "ANTHROPIC_API_KEY", provider: "anthropic", create,
};
