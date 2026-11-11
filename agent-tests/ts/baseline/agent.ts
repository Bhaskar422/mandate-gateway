// The baseline agent: the same catalogue tools as the gateway runs, plus PayPal's own order tools from the
// official PayPal Agent Toolkit (@paypal/agent-toolkit), and no gateway. One agent with all the tools ("single").
// Claude runs on the Anthropic SDK; GPT and Gemini run on their OpenAI-style chat completions endpoints.
import Anthropic from "@anthropic-ai/sdk";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import { toolsFor } from "../harness/tools";
import { StepLimitError, type Recorder } from "../harness/types";

export type BaselineEnv = { model: string; system: string; storeUrl: string; recorder: Recorder; maxSteps: number; signal: AbortSignal };
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

function tools(env: BaselineEnv, tk: PayPalAgentToolkit, createdOrderIds: string[]): Tool[] {
  const store: Tool[] = toolsFor("store").map((t) => ({
    name: t.name, description: t.description, parameters: t.jsonSchema,
    run: (args) => t.run(args, { gatewayUrl: env.storeUrl, agentKey: "", recorder: env.recorder, agent: "agent", signal: env.signal }),
  }));
  // The toolkit's schemas are passed to the model as published, minus the "$schema" keyword some providers reject.
  const paypal: Tool[] = tk.getTools().map((t) => {
    const { $schema: _drop, ...parameters } = (t.function.parameters ?? {}) as Json;
    return {
      name: t.function.name, description: (t.function.description ?? "").trim(), parameters,
      async run(args) {
        env.recorder.tool(t.function.name, args, "agent");
        const out = await tk.handleToolCall({ id: "call", type: "function", function: { name: t.function.name, arguments: JSON.stringify(args) } });
        const text = typeof out.content === "string" ? out.content : JSON.stringify(out.content);
        if (t.function.name === "create_order") { try { const id = (JSON.parse(text) as Json).id; if (typeof id === "string") createdOrderIds.push(id); } catch { /* not an order */ } }
        return text;
      },
    };
  });
  return [...store, ...paypal];
}

async function runTool(all: Tool[], name: string, args: unknown): Promise<string> {
  const t = all.find((x) => x.name === name);
  if (!t) return JSON.stringify({ error: `Unknown tool ${name}` });
  try { return await t.run((args && typeof args === "object" ? args : {}) as Json); }
  catch (e) { return JSON.stringify({ error: e instanceof Error ? e.message : String(e) }); }
}

async function claude(env: BaselineEnv, all: Tool[], user: string): Promise<string> {
  const client = new Anthropic({ maxRetries: 3 });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  for (let step = 1; ; step++) {
    if (step > env.maxSteps) throw new StepLimitError(env.maxSteps);
    const res = await client.messages.create({
      model: env.model, max_tokens: 8000, system: env.system, messages, tool_choice: { type: "auto" },
      tools: all.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema })),
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
async function chatCompletions(env: BaselineEnv, all: Tool[], user: string, url: string, key: string): Promise<string> {
  const messages: ChatMessage[] = [{ role: "system", content: env.system }, { role: "user", content: user }];
  for (let step = 1; ; step++) {
    if (step > env.maxSteps) throw new StepLimitError(env.maxSteps);
    const body = JSON.stringify({ model: env.model, messages, tools: all.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) });
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

/** One user turn. Returns the agent's final text and the ids of the PayPal orders it created. */
export async function runBaselineAgent(env: BaselineEnv, tk: PayPalAgentToolkit, user: string): Promise<{ finalText: string; createdOrderIds: string[] }> {
  const createdOrderIds: string[] = [];
  const all = tools(env, tk, createdOrderIds);
  const provider = providerOf(env.model), key = process.env[keyEnvOf(env.model)] ?? "";
  try {
    const finalText = provider === "anthropic" ? await claude(env, all, user)
      : provider === "google" ? await chatCompletions(env, all, user, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key)
      : await chatCompletions(env, all, user, "https://api.openai.com/v1/chat/completions", key);
    return { finalText, createdOrderIds };
  } catch (e) { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { createdOrderIds }); }
}
