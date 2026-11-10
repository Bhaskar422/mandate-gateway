"""Framework 5: LangGraph (Python) with langchain-anthropic. Each role is a model/tools graph; the
architectures are outer graphs wiring roles together. An InMemorySaver keeps state between user turns."""
from __future__ import annotations

import operator
import uuid
from typing import Annotated, Any, TypedDict

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AnyMessage, HumanMessage, SystemMessage
from langchain_core.tools import StructuredTool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.errors import GraphRecursionError
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode

from harness.shared import PROMPTS, fill
from harness.tools import ToolEnv, build_functions
from harness.types import AgentContext, Framework, StepLimitError, TurnTimeout


def _text(message: AnyMessage) -> str:
    c = message.content
    if isinstance(c, str):
        return c.strip()
    return "\n".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text").strip()


class State(TypedDict, total=False):
    user: str
    final: str
    plan: str
    handoff: str
    handed_off: bool
    a: Annotated[list[AnyMessage], operator.add]  # messages of the architecture's first role
    b: Annotated[list[AnyMessage], operator.add]  # messages of its second role


async def create(ctx: AgentContext):
    llm = ChatAnthropic(model=ctx.model, max_tokens=8000, max_retries=2)
    steps = {"n": 0}

    def role(name: str, system: str, groups: list[str]):
        """A role: model node and tool node in a loop until the model stops calling tools."""
        tools = [StructuredTool.from_function(coroutine=f, name=f.__name__, description=f.__doc__, parse_docstring=False)
                 for f in build_functions(ToolEnv(ctx, name), *groups)]
        model = llm.bind_tools(tools, tool_choice="auto") if tools else llm

        async def call_model(state: MessagesState) -> dict[str, Any]:
            steps["n"] += 1
            if steps["n"] > ctx.max_steps:
                raise StepLimitError(ctx.max_steps)
            res = await model.ainvoke([SystemMessage(system), *state["messages"]])
            usage = res.usage_metadata or {}
            ctx.recorder.usage(usage.get("input_tokens"), usage.get("output_tokens"))
            return {"messages": [res]}

        g = StateGraph(MessagesState)
        g.add_node("model", call_model)
        g.add_edge(START, "model")
        if tools:
            # Cap errors must stop the run, not be handed back to the model as a tool error.
            g.add_node("tools", ToolNode(tools, handle_tool_errors=lambda e: (_ for _ in ()).throw(e) if isinstance(e, (StepLimitError, TurnTimeout)) else f"Error: {e}"))
            g.add_conditional_edges("model", lambda s: "tools" if s["messages"][-1].tool_calls else END, ["tools", END])
            g.add_edge("tools", "model")
        else:
            g.add_edge("model", END)
        return g.compile()

    async def run_role(r, history: list[AnyMessage], text: str) -> tuple[list[AnyMessage], str]:
        out = await r.ainvoke({"messages": [*history, HumanMessage(text)]}, {"recursion_limit": ctx.max_steps * 2 + 2})
        return out["messages"][len(history):], _text(out["messages"][-1])

    g = StateGraph(State)
    if ctx.architecture == "single":
        agent = role("agent", PROMPTS["system"], ["store", "gateway"])

        async def agent_node(s: State):
            added, text = await run_role(agent, s.get("a", []), s["user"])
            return {"a": added, "final": text}

        g.add_node("agent", agent_node)
        g.add_edge(START, "agent")
        g.add_edge("agent", END)
    elif ctx.architecture == "planner_executor":
        planner = role("planner", PROMPTS["planner"], [])
        executor = role("executor", f"{PROMPTS['system']}\n\n{PROMPTS['executor_suffix']}", ["store", "gateway"])

        async def planner_node(s: State):
            added, text = await run_role(planner, s.get("a", []), s["user"])
            return {"a": added, "plan": text}

        async def executor_node(s: State):
            added, text = await run_role(executor, s.get("b", []), fill(PROMPTS["executor_turn"], user=s["user"], plan=s["plan"]))
            return {"b": added, "final": text}

        g.add_node("planner", planner_node)
        g.add_node("executor", executor_node)
        g.add_edge(START, "planner")
        g.add_edge("planner", "executor")
        g.add_edge("executor", END)
    else:
        # multi_agent: the shopper hands off to the buyer; after the handoff, user turns route straight to the buyer.
        shopper = role("shopper", PROMPTS["shopper"], ["store"])
        buyer = role("buyer", PROMPTS["buyer"], ["gateway"])

        async def shopper_node(s: State):
            added, text = await run_role(shopper, s.get("a", []), s["user"])
            return {"a": added, "handoff": text}

        async def buyer_node(s: State):
            text_in = s["user"] if s.get("handed_off") else fill(PROMPTS["buyer_turn"], user=s["user"], handoff=s["handoff"])
            added, text = await run_role(buyer, s.get("b", []), text_in)
            return {"b": added, "final": text, "handed_off": True}

        g.add_node("shopper", shopper_node)
        g.add_node("buyer", buyer_node)
        g.add_conditional_edges(START, lambda s: "buyer" if s.get("handed_off") else "shopper", ["shopper", "buyer"])
        g.add_edge("shopper", "buyer")
        g.add_edge("buyer", END)

    app = g.compile(checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": str(uuid.uuid4())}}

    class Session:
        async def send(self, user_text: str) -> str:
            steps["n"] = 0
            try:
                out = await app.ainvoke({"user": user_text}, config)
            except GraphRecursionError:
                raise StepLimitError(ctx.max_steps) from None
            return out.get("final", "")

        async def close(self) -> None:
            pass

    return Session()


FRAMEWORK = Framework(name="langgraph-py", architectures=["single", "planner_executor", "multi_agent"], native_mcp=False,
                      requires_env="ANTHROPIC_API_KEY", provider="anthropic", create=create)
