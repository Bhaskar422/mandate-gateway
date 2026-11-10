// Framework 4: LangGraph JS with @langchain/anthropic. Each role is a small agent/tools graph; the
// architectures are outer graphs that wire roles together. A MemorySaver checkpointer keeps the
// conversation between user turns.
import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { Annotation, END, GraphRecursionError, MemorySaver, MessagesAnnotation, START, StateGraph, messagesStateReducer } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { PROMPTS } from "../harness/scenarios";
import { toolsFor, type ToolGroup } from "../harness/tools";
import { StepLimitError, type AgentContext, type AgentSession, type Framework } from "../harness/types";

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
const textOf = (m: BaseMessage | undefined) => !m ? "" : typeof m.content === "string" ? m.content.trim()
  : m.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n").trim();

async function create(ctx: AgentContext): Promise<AgentSession> {
  const llm = new ChatAnthropic({ model: ctx.model, maxTokens: 8000, maxRetries: 2 });
  let steps = 0;

  /** A role: model node and tool node in a loop until the model stops calling tools. */
  function role(name: string, system: string, groups: ToolGroup[]) {
    const tools = toolsFor(...groups).map((t) => tool(
      (input: Record<string, unknown>) => t.run(input, { gatewayUrl: ctx.gatewayUrl, agentKey: ctx.agentKey, recorder: ctx.recorder, agent: name, signal: ctx.signal() }),
      { name: t.name, description: t.description, schema: t.schema }));
    const model = tools.length ? llm.bindTools(tools, { tool_choice: "auto" }) : llm;
    const g = new StateGraph(MessagesAnnotation)
      .addNode("model", async (s) => {
        if (++steps > ctx.maxSteps) throw new StepLimitError(ctx.maxSteps);
        const res = await model.invoke([new SystemMessage(system), ...s.messages], { signal: ctx.signal() });
        ctx.recorder.usage(res.usage_metadata?.input_tokens, res.usage_metadata?.output_tokens);
        return { messages: [res] };
      })
      .addEdge(START, "model");
    if (!tools.length) return g.addEdge("model", END).compile();
    return g.addNode("tools", new ToolNode(tools))
      .addConditionalEdges("model", (s) => ((s.messages.at(-1) as AIMessage).tool_calls?.length ? "tools" : END), ["tools", END])
      .addEdge("tools", "model").compile();
  }
  type Role = ReturnType<typeof role>;
  /** Run a role on its own message list; returns the new messages and the role's final text. */
  async function runRole(r: Role, history: BaseMessage[], input: string) {
    const out = await r.invoke({ messages: [...history, new HumanMessage(input)] }, { recursionLimit: ctx.maxSteps * 2 + 2, signal: ctx.signal() });
    return { added: out.messages.slice(history.length), text: textOf(out.messages.at(-1)) };
  }

  const msgs = () => Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] });
  const State = Annotation.Root({
    user: Annotation<string>(), final: Annotation<string>(), plan: Annotation<string>(), handoff: Annotation<string>(),
    handedOff: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
    a: msgs(), b: msgs(), // message lists for the first and second role of the architecture
  });
  type S = typeof State.State;

  let graph;
  if (ctx.architecture === "single") {
    const agent = role("agent", PROMPTS.system, ["store", "gateway"]);
    graph = new StateGraph(State)
      .addNode("agent", async (s: S) => { const r = await runRole(agent, s.a, s.user); return { a: r.added, final: r.text }; })
      .addEdge(START, "agent").addEdge("agent", END);
  } else if (ctx.architecture === "planner_executor") {
    const planner = role("planner", PROMPTS.planner, []);
    const executor = role("executor", `${PROMPTS.system}\n\n${PROMPTS.executor_suffix}`, ["store", "gateway"]);
    graph = new StateGraph(State)
      .addNode("planner", async (s: S) => { const r = await runRole(planner, s.a, s.user); return { a: r.added, plan: r.text }; })
      .addNode("executor", async (s: S) => { const r = await runRole(executor, s.b, fill(PROMPTS.executor_turn, { user: s.user, plan: s.plan })); return { b: r.added, final: r.text }; })
      .addEdge(START, "planner").addEdge("planner", "executor").addEdge("executor", END);
  } else {
    // multi_agent: the shopper hands off to the buyer; after the handoff, user turns route straight to the buyer.
    const shopper = role("shopper", PROMPTS.shopper, ["store"]);
    const buyer = role("buyer", PROMPTS.buyer, ["gateway"]);
    graph = new StateGraph(State)
      .addNode("shopper", async (s: S) => { const r = await runRole(shopper, s.a, s.user); return { a: r.added, handoff: r.text }; })
      .addNode("buyer", async (s: S) => {
        const input = s.handedOff ? s.user : fill(PROMPTS.buyer_turn, { user: s.user, handoff: s.handoff });
        const r = await runRole(buyer, s.b, input);
        return { b: r.added, final: r.text, handedOff: true };
      })
      .addConditionalEdges(START, (s: S) => (s.handedOff ? "buyer" : "shopper"), ["shopper", "buyer"])
      .addEdge("shopper", "buyer").addEdge("buyer", END);
  }
  const app = graph.compile({ checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: `run-${Date.now()}-${Math.random().toString(36).slice(2)}` } };

  return {
    async send(user) {
      steps = 0;
      try {
        const out = await app.invoke({ user }, { ...config, signal: ctx.signal() });
        return out.final ?? "";
      } catch (e) {
        if (e instanceof GraphRecursionError) throw new StepLimitError(ctx.maxSteps);
        throw e;
      }
    },
  };
}

export const langgraphJs: Framework = {
  name: "langgraph-js", architectures: ["single", "planner_executor", "multi_agent"], nativeMcp: false,
  requiresEnv: "ANTHROPIC_API_KEY", provider: "anthropic", create,
};
