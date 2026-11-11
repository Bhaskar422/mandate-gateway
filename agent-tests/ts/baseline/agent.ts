// The baseline agent: the same catalogue tools as the gateway runs, plus PayPal's own order tools from the
// official PayPal Agent Toolkit (@paypal/agent-toolkit), and no gateway. Three architectures, split the way the
// gateway suite splits them (agents/anthropic-sdk.ts), with the PayPal tools where the gateway tools were:
//   single            one agent with all the tools
//   planner_executor  a planner with no tools writes a plan; an executor with all the tools carries it out
//   multi_agent       a shopper with only the catalogue tools hands off to a buyer with only the PayPal tools
// Claude runs on the Anthropic SDK; GPT and Gemini run on their OpenAI-style chat completions endpoints.
import Anthropic from "@anthropic-ai/sdk";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import { toolsFor } from "../harness/tools";
import { PROMPTS } from "../harness/scenarios";
import { StepLimitError, type Architecture, type Recorder } from "../harness/types";

/** `mandate` is the mandate text for the prompts; `hardened` appends the hardened block to every agent's prompt. */
export type BaselineEnv = { model: string; architecture: Architecture; mandate: string; hardened: boolean; storeUrl: string; recorder: Recorder; maxSteps: number; signal: AbortSignal };
/** One agent of a run: its name in the trace, its system prompt and its tools. `steps` is shared by the agents of a turn. */
type Role = { agent: string; system: string; tools: Tool[]; steps: { n: number } };
type Tool = { name: string; description: string; parameters: Record<string, unknown>; run(args: Record<string, unknown>): Promise<string> };
type Json = Record<string, unknown>;

/** The toolkit's payment tools against the PayPal sandbox: create_order, get_order, pay_order. */
export function paypalToolkit() {
  const clientId = process.env.PAYPAL_CLIENT_ID, clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set");
  return new PayPalAgentToolkit({ clientId, clientSecret, configuration: { actions: { orders: { create: true, get: true, capture: true } }, context: { sandbox: true } } });
}

/** PayPal's record of an order, read with the toolkit's own client. */
export async function fetchOrder(tk: PayPalAgentToolkit, id: string): Promise<Json> {
  const res = await fetch(`${tk.client.getBaseUrl()}/v2/checkout/orders/${id}`, { headers: await tk.client.getHeaders() });
  if (!res.ok) throw new Error(`PayPal GET order ${id}: HTTP ${res.status}`);
  return (await res.json()) as Json;
}

function tools(env: BaselineEnv, tk: PayPalAgentToolkit, createdOrderIds: string[], agent: string, groups: ("store" | "paypal")[]): Tool[] {
  const store: Tool[] = toolsFor("store").map((t) => ({
    name: t.name, description: t.description, parameters: t.jsonSchema,
    run: (args) => t.run(args, { gatewayUrl: env.storeUrl, agentKey: "", recorder: env.recorder, agent, signal: env.signal }),
  }));
  // The toolkit's schemas are passed to the model as published, minus the "$schema" keyword some providers reject.
  const paypal: Tool[] = tk.getTools().map((t) => {
    const { $schema: _drop, ...parameters } = (t.function.parameters ?? {}) as Json;
    return {
      name: t.function.name, description: (t.function.description ?? "").trim(), parameters,
      async run(args) {
        env.recorder.tool(t.function.name, args, agent);
        const out = await tk.handleToolCall({ id: "call", type: "function", function: { name: t.function.name, arguments: JSON.stringify(args) } });
        const text = typeof out.content === "string" ? out.content : JSON.stringify(out.content);
        if (t.function.name === "create_order") { try { const id = (JSON.parse(text) as Json).id; if (typeof id === "string") createdOrderIds.push(id); } catch { /* not an order */ } }
        return text;
      },
    };
  });
  return [...(groups.includes("store") ? store : []), ...(groups.includes("paypal") ? paypal : [])];
}

async function runTool(all: Tool[], name: string, args: unknown): Promise<string> {
  const t = all.find((x) => x.name === name);
  if (!t) return JSON.stringify({ error: `Unknown tool ${name}` });
  try { return await t.run((args && typeof args === "object" ? args : {}) as Json); }
  catch (e) { return JSON.stringify({ error: e instanceof Error ? e.message : String(e) }); }
}

async function claude(env: BaselineEnv, role: Role, user: string): Promise<string> {
  const all = role.tools;
  const client = new Anthropic({ maxRetries: 3 });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  for (;;) {
    if (++role.steps.n > env.maxSteps) throw new StepLimitError(env.maxSteps);
    const res = await client.messages.create({
      model: env.model, max_tokens: 8000, system: role.system, messages,
      ...(all.length ? { tool_choice: { type: "auto" as const }, tools: all.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema })) } : {}),
    }, { signal: env.signal });
    const u = res.usage;
    env.recorder.usage(u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), u.output_tokens);
    if (res.stop_reason === "refusal") throw new Error("the model refused");
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason !== "tool_use") return res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const b of res.content) if (b.type === "tool_use") results.push({ type: "tool_result", tool_use_id: b.id, content: await runTool(all, b.name, b.input) });
    messages.push({ role: "user", content: results });
  }
}

type ChatMessage = { role: string; content?: unknown; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string };
/** OpenAI-style chat completions, used for OpenAI itself and for Gemini's OpenAI-compatible endpoint. */
async function chatCompletions(env: BaselineEnv, role: Role, user: string, url: string, key: string): Promise<string> {
  const all = role.tools;
  const messages: ChatMessage[] = [{ role: "system", content: role.system }, { role: "user", content: user }];
  for (;;) {
    if (++role.steps.n > env.maxSteps) throw new StepLimitError(env.maxSteps);
    const body = JSON.stringify({ model: env.model, messages, ...(all.length ? { tools: all.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}) });
    let json: { choices?: { message: ChatMessage }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } } | null = null;
    for (let attempt = 1; !json; attempt++) {
      const res = await fetch(url, { method: "POST", signal: env.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body });
      if (res.ok) { json = await res.json(); break; }
      const text = (await res.text()).slice(0, 300);
      if (![429, 500, 502, 503].includes(res.status) || attempt >= 5) throw new Error(`model API HTTP ${res.status}: ${text}`);
      await new Promise((r) => setTimeout(r, 4000 * attempt));
    }
    env.recorder.usage(json!.usage?.prompt_tokens, json!.usage?.completion_tokens);
    const msg = json!.choices?.[0]?.message;
    if (!msg) throw new Error("model API returned no message");
    messages.push(msg); // sent back as received, so provider extras on tool calls (Gemini thought signatures) survive
    if (!msg.tool_calls?.length) return typeof msg.content === "string" ? msg.content.trim() : "";
    for (const c of msg.tool_calls) {
      let args: unknown = {};
      try { args = JSON.parse(c.function.arguments || "{}"); } catch { /* the tool reports the bad arguments */ }
      messages.push({ role: "tool", tool_call_id: c.id, content: await runTool(all, c.function.name, args) });
    }
  }
}

export const providerOf = (model: string) => (model.startsWith("claude") ? "anthropic" : model.startsWith("gemini") ? "google" : "openai");
export const keyEnvOf = (model: string) => ({ anthropic: "ANTHROPIC_API_KEY", google: "GOOGLE_API_KEY", openai: "OPENAI_API_KEY" })[providerOf(model)];

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

/**
 * One user turn. Returns the last agent's final text. `createdOrderIds` collects the ids of the PayPal orders created and
 * `between.text` the plan or handoff passed between the agents; both are filled even if the turn throws.
 */
export async function runBaselineAgent(env: BaselineEnv, tk: PayPalAgentToolkit, user: string, createdOrderIds: string[], between: { text?: string }): Promise<string> {
  const provider = providerOf(env.model), key = process.env[keyEnvOf(env.model)] ?? "";
  const steps = { n: 0 }; // one step budget per user turn, shared by the agents, as in the gateway suite
  // Without a gateway the prompt is the only place the mandate can live, so every agent's prompt carries it.
  const role = (agent: string, prompt: string, groups: ("store" | "paypal")[], suffix = ""): Role => ({
    agent, steps, tools: tools(env, tk, createdOrderIds, agent, groups),
    system: fill(prompt, { mandate: env.mandate }) + (suffix ? `\n\n${suffix}` : "") + (env.hardened ? `\n\n${PROMPTS.baseline_hardened_suffix}` : ""),
  });
  const run = (r: Role, text: string) => provider === "anthropic" ? claude(env, r, text)
    : provider === "google" ? chatCompletions(env, r, text, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key)
    : chatCompletions(env, r, text, "https://api.openai.com/v1/chat/completions", key);
  if (env.architecture === "single") return run(role("agent", PROMPTS.baseline_system, ["store", "paypal"]), user);
  if (env.architecture === "planner_executor") {
    const plan = between.text = await run(role("planner", PROMPTS.baseline_planner, []), user);
    return run(role("executor", PROMPTS.baseline_system, ["store", "paypal"], PROMPTS.executor_suffix), fill(PROMPTS.executor_turn, { user, plan }));
  }
  // multi_agent: the shopper's final message is the handoff; the buyer gets the user's message and the handoff.
  const handoff = between.text = await run(role("shopper", PROMPTS.baseline_shopper, ["store"]), user);
  return run(role("buyer", PROMPTS.baseline_buyer, ["paypal"]), fill(PROMPTS.buyer_turn, { user, handoff }));
}
