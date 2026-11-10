"""Framework 8: the OpenAI Agents SDK with a GPT model. Skipped unless OPENAI_API_KEY is set.

- single:           one Agent with the six function tools.
- planner_executor: a tool-less planner Agent, then an executor Agent.
- multi_agent:      the SDK's native handoffs: the shopper Agent hands off to the buyer Agent, and
                    follow-up user turns go to whichever agent was last active.

NOT YET RUN AGAINST A LIVE MODEL (no OpenAI key was available when this was written): it imports and
constructs, and `python -m harness.run --construct-only` checks that.
"""
from __future__ import annotations

from typing import Any

from agents import Agent, Runner, function_tool, set_tracing_disabled
from agents.exceptions import MaxTurnsExceeded

from harness.shared import PROMPTS, fill
from harness.tools import ToolEnv, build_functions
from harness.types import AgentContext, Framework, StepLimitError

set_tracing_disabled(True)  # do not upload run traces to OpenAI


async def create(ctx: AgentContext):
    def tools(agent: str, *groups: str) -> list[Any]:
        return [function_tool(f) for f in build_functions(ToolEnv(ctx, agent), *groups)]

    async def run(agent: Agent, history: list[Any], text: str) -> tuple[str, Agent]:
        """Run from `agent` on its conversation so far. `history` is replaced with the SDK's input list for the next turn."""
        try:
            result = await Runner.run(agent, [*history, {"role": "user", "content": text}], max_turns=ctx.max_steps)
        except MaxTurnsExceeded:
            raise StepLimitError(ctx.max_steps) from None
        usage = result.context_wrapper.usage
        ctx.recorder.usage(usage.input_tokens, usage.output_tokens, usage.requests)
        history[:] = result.to_input_list()
        return str(result.final_output).strip(), result.last_agent

    if ctx.architecture == "single":
        single = Agent(name="Shopping assistant", instructions=PROMPTS["system"], model=ctx.model, tools=tools("agent", "store", "gateway"))
        h: list[Any] = []

        async def send(user: str) -> str:
            return (await run(single, h, user))[0]
    elif ctx.architecture == "planner_executor":
        planner = Agent(name="Planner", instructions=PROMPTS["planner"], model=ctx.model)
        executor = Agent(name="Executor", instructions=f"{PROMPTS['system']}\n\n{PROMPTS['executor_suffix']}", model=ctx.model, tools=tools("executor", "store", "gateway"))
        ph: list[Any] = []
        eh: list[Any] = []

        async def send(user: str) -> str:
            plan, _ = await run(planner, ph, user)
            return (await run(executor, eh, fill(PROMPTS["executor_turn"], user=user, plan=plan)))[0]
    else:
        buyer = Agent(name="Buyer", instructions=PROMPTS["buyer"], model=ctx.model, tools=tools("buyer", "gateway"),
                      handoff_description="Pays for a product through the Mandate payment gateway, checks purchases and reports problems.")
        shopper = Agent(name="Shopper", instructions=PROMPTS["shopper"], model=ctx.model, tools=tools("shopper", "store"), handoffs=[buyer])
        state: dict[str, Any] = {"active": shopper, "history": []}

        async def send(user: str) -> str:
            text, state["active"] = await run(state["active"], state["history"], user)
            return text

    class Session:
        async def send(self, user_text: str) -> str:
            return await send(user_text)

        async def close(self) -> None:
            pass

    return Session()


FRAMEWORK = Framework(name="openai-agents", architectures=["single", "planner_executor", "multi_agent"], native_mcp=False,
                      requires_env="OPENAI_API_KEY", provider="openai", create=create)
