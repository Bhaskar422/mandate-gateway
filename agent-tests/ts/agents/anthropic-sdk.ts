// Framework 1: the Anthropic SDK with a hand-written tool loop.
import Anthropic from "@anthropic-ai/sdk";
import { PROMPTS } from "../harness/scenarios";
import { toolsFor, type ToolSpec } from "../harness/tools";
import { StepLimitError, type AgentContext, type AgentSession, type Framework } from "../harness/types";

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
const textOf = (m: Anthropic.Message) => m.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();

async function create(ctx: AgentContext): Promise<AgentSession> {
  const client = new Anthropic({ maxRetries: 2 });
  let steps = 0;

  /** One model call. No temperature, no thinking config, tool_choice auto: the current models reject the alternatives. */
  async function call(system: string, messages: Anthropic.MessageParam[], tools: ToolSpec[]) {
    if (++steps > ctx.maxSteps) throw new StepLimitError(ctx.maxSteps);
    const res = await client.messages.create({
      model: ctx.model, max_tokens: 8000, system, messages,
      ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.jsonSchema as Anthropic.Tool.InputSchema })), tool_choice: { type: "auto" as const } } : {}),
    }, { signal: ctx.signal() });
    const u = res.usage;
    ctx.recorder.usage(u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), u.output_tokens);
    if (res.stop_reason === "refusal") throw new Error(`the model refused (${res.stop_details?.category ?? "no category"})`);
    return res;
  }

  /** Run one agent until it stops asking for tools. `messages` is mutated so the agent keeps its history. */
  async function loop(agent: string, system: string, messages: Anthropic.MessageParam[], tools: ToolSpec[]): Promise<string> {
    for (;;) {
      const res = await call(system, messages, tools);
      messages.push({ role: "assistant", content: res.content });
      if (res.stop_reason !== "tool_use") return textOf(res);
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const b of res.content) {
        if (b.type !== "tool_use") continue;
        const t = tools.find((x) => x.name === b.name);
        const content = t
          ? await t.run(b.input as Record<string, unknown>, { gatewayUrl: ctx.gatewayUrl, agentKey: ctx.agentKey, recorder: ctx.recorder, agent, signal: ctx.signal() })
          : JSON.stringify({ error: `Unknown tool ${b.name}` });
        results.push({ type: "tool_result", tool_use_id: b.id, content, ...(t ? {} : { is_error: true }) });
      }
      messages.push({ role: "user", content: results });
    }
  }

  if (ctx.architecture === "single") {
    const messages: Anthropic.MessageParam[] = [];
    return { async send(user) { steps = 0; messages.push({ role: "user", content: user }); return loop("agent", PROMPTS.system, messages, toolsFor("store", "gateway")); } };
  }

  if (ctx.architecture === "planner_executor") {
    const plannerMessages: Anthropic.MessageParam[] = [], executorMessages: Anthropic.MessageParam[] = [];
    return {
      async send(user) {
        steps = 0;
        plannerMessages.push({ role: "user", content: user });
        const plan = await loop("planner", PROMPTS.planner, plannerMessages, []);
        executorMessages.push({ role: "user", content: fill(PROMPTS.executor_turn, { user, plan }) });
        return loop("executor", `${PROMPTS.system}\n\n${PROMPTS.executor_suffix}`, executorMessages, toolsFor("store", "gateway"));
      },
    };
  }

  // multi_agent: the shopper (catalogue tools only) finds the product and hands off to the buyer (gateway tools only).
  // After the handoff the buyer owns the conversation, so follow-up user turns go to the buyer.
  const shopperMessages: Anthropic.MessageParam[] = [], buyerMessages: Anthropic.MessageParam[] = [];
  let handedOff = false;
  return {
    async send(user) {
      steps = 0;
      if (handedOff) { buyerMessages.push({ role: "user", content: user }); return loop("buyer", PROMPTS.buyer, buyerMessages, toolsFor("gateway")); }
      shopperMessages.push({ role: "user", content: user });
      const handoff = await loop("shopper", PROMPTS.shopper, shopperMessages, toolsFor("store"));
      handedOff = true;
      buyerMessages.push({ role: "user", content: fill(PROMPTS.buyer_turn, { user, handoff }) });
      return loop("buyer", PROMPTS.buyer, buyerMessages, toolsFor("gateway"));
    },
  };
}

export const anthropicSdk: Framework = {
  name: "anthropic-sdk", architectures: ["single", "planner_executor", "multi_agent"], nativeMcp: false,
  requiresEnv: "ANTHROPIC_API_KEY", provider: "anthropic", create,
};
