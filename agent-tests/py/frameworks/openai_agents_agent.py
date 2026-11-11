"""Framework 8: the OpenAI Agents SDK with a GPT model. Skipped unless OPENAI_API_KEY is set.

- single:           one Agent with the six function tools.
- planner_executor: a tool-less planner Agent, then an executor Agent.
- multi_agent:      the SDK's native handoffs: the shopper Agent hands off to the buyer Agent with a typed payload
                    (product name, URL, unit price), and follow-up user turns go to whichever agent was last
                    active. If the shopper ends its turn without calling the handoff tool, the adapter passes
                    its message to the buyer itself.
"""
from __future__ import annotations

from typing import Any

from agents import Agent, HandoffInputData, RunContextWrapper, Runner, function_tool, handoff, set_tracing_disabled
from agents.exceptions import MaxTurnsExceeded
from agents.extensions.handoff_prompt import RECOMMENDED_PROMPT_PREFIX
from pydantic import BaseModel

from harness.shared import PROMPTS, fill
from harness.tools import ToolEnv, build_functions
from harness.types import AgentContext, Framework, StepLimitError

class HandoffNote(BaseModel):
    """What the shopper passes to the buyer when it hands off."""
    product_name: str
    product_url: str
    unit_price: str
    notes: str


set_tracing_disabled(True)  # do not upload run traces to OpenAI


async def create(ctx: AgentContext):
    def tools(agent: str, *groups: str) -> list[Any]:
        return [function_tool(f) for f in build_functions(ToolEnv(ctx, agent), *groups)]

    async def run(agent: Agent, history: list[Any], text: str | None, max_turns: int | None = None) -> tuple[str, Agent, int]:
        """Run from `agent` on its conversation so far (plus a new user message, if any). `history` is replaced with
        the SDK's input list for the next turn. Returns the final text, the agent that ended the run and the model calls used."""
        new = [{"role": "user", "content": text}] if text is not None else []
        try:
            result = await Runner.run(agent, [*history, *new], max_turns=max_turns or ctx.max_steps)
        except MaxTurnsExceeded:
            raise StepLimitError(ctx.max_steps) from None
        usage = result.context_wrapper.usage
        ctx.recorder.usage(usage.input_tokens, usage.output_tokens, usage.requests)
        history[:] = result.to_input_list()
        return str(result.final_output).strip(), result.last_agent, usage.requests

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
            plan = (await run(planner, ph, user))[0]
            return (await run(executor, eh, fill(PROMPTS["executor_turn"], user=user, plan=plan)))[0]
    else:
        # The handoff is the SDK's native one, with a typed payload: to transfer, the shopper must fill in the product
        # name, page URL and unit price. The buyer then starts from the same `buyer_turn` message the other frameworks
        # give it (user message + handoff), not from the shopper's transcript: with the raw transcript, the buyer tended
        # to continue the shopper's "handing off now" narration instead of using its tools.
        buyer = Agent(name="Buyer", instructions=PROMPTS["buyer"], model=ctx.model, tools=tools("buyer", "gateway"),
                      handoff_description="Pays for a product through the Mandate payment gateway, checks purchases and reports problems.")
        state: dict[str, Any] = {"active": None, "history": [], "user": "", "handoff": ""}

        async def on_handoff(_ctx: RunContextWrapper[Any], data: HandoffNote) -> None:
            state["handoff"] = f"Product: {data.product_name}\nProduct page URL: {data.product_url}\nUnit price: {data.unit_price}\nNotes: {data.notes}"

        def to_buyer(data: HandoffInputData) -> HandoffInputData:
            first = {"role": "user", "content": fill(PROMPTS["buyer_turn"], user=state["user"], handoff=state["handoff"])}
            return data.clone(input_history=(first,), pre_handoff_items=(), input_items=())

        shopper = Agent(name="Shopper", instructions=f"{RECOMMENDED_PROMPT_PREFIX}\n\n{PROMPTS['shopper']}\n\n{PROMPTS['shopper_transfer_suffix']}", model=ctx.model,
                        tools=tools("shopper", "store"), handoffs=[handoff(buyer, on_handoff=on_handoff, input_type=HandoffNote, input_filter=to_buyer)])
        state["active"] = shopper

        async def send(user: str) -> str:
            state["user"] = user
            text, state["active"], used = await run(state["active"], state["history"], user)
            if state["active"] is shopper:
                # The shopper ended its turn with the handoff written as a message instead of calling the handoff tool.
                # Nothing would reach the buyer, so pass that message on in code, within the same per-turn step cap.
                if used >= ctx.max_steps:
                    raise StepLimitError(ctx.max_steps)
                state["history"] = []
                text, state["active"], _ = await run(buyer, state["history"], fill(PROMPTS["buyer_turn"], user=user, handoff=text), max_turns=ctx.max_steps - used)
            return text

    class Session:
        async def send(self, user_text: str) -> str:
            return await send(user_text)

        async def close(self) -> None:
            pass

    return Session()


FRAMEWORK = Framework(name="openai-agents", architectures=["single", "planner_executor", "multi_agent"], native_mcp=False,
                      requires_env="OPENAI_API_KEY", provider="openai", create=create)
