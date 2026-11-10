"""Framework 7: Pydantic AI, connected to the gateway and the stores through its native MCP client
(MCPToolset over Streamable HTTP, three servers). No tool wrappers of ours are involved: this proves MCP interop."""
from __future__ import annotations

from typing import Any

from pydantic_ai import Agent
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.usage import UsageLimits

from harness.shared import PROMPTS, fill
from harness.tools import canonical_tool_call, mcp_urls
from harness.types import AgentContext, Framework, StepLimitError


async def create(ctx: AgentContext):
    urls = mcp_urls(ctx.gateway_url)

    def store_toolsets() -> list[Any]:
        return [MCPToolset(urls["stride"], id="stride").prefixed("stride"), MCPToolset(urls["kickz"], id="kickz").prefixed("kickz")]

    def gateway_toolsets() -> list[Any]:
        return [MCPToolset(urls["gateway"], id="mandate", headers={"Authorization": f"Bearer {ctx.agent_key}"}).prefixed("mandate")]

    def agent(instructions: str, toolsets: list[Any]) -> Agent:
        return Agent(f"anthropic:{ctx.model}", instructions=instructions, toolsets=toolsets, model_settings={"max_tokens": 8000})

    requests_left = {"n": ctx.max_steps}

    async def run(a: Agent, name: str, history: list[ModelMessage], text: str) -> str:
        """One role, run to completion. `history` is extended in place so the role keeps its conversation."""
        if requests_left["n"] <= 0:
            raise StepLimitError(ctx.max_steps)
        try:
            result = await a.run(text, message_history=history or None, usage_limits=UsageLimits(request_limit=requests_left["n"]))
        except UsageLimitExceeded:
            raise StepLimitError(ctx.max_steps) from None
        usage = result.usage
        requests_left["n"] -= usage.requests
        ctx.recorder.usage(usage.input_tokens + usage.cache_read_tokens + usage.cache_write_tokens, usage.output_tokens, usage.requests)
        for m in result.new_messages():
            if isinstance(m, ModelResponse):
                for part in m.parts:
                    if isinstance(part, ToolCallPart):
                        tool, args = canonical_tool_call(part.tool_name, part.args_as_dict())
                        ctx.recorder.tool(tool, args, name)
        history[:] = result.all_messages()
        return str(result.output).strip()

    if ctx.architecture == "single":
        single, h = agent(PROMPTS["system"], store_toolsets() + gateway_toolsets()), []

        async def send(user: str) -> str:
            return await run(single, "agent", h, user)
    elif ctx.architecture == "planner_executor":
        planner, executor = agent(PROMPTS["planner"], []), agent(f"{PROMPTS['system']}\n\n{PROMPTS['executor_suffix']}", store_toolsets() + gateway_toolsets())
        ph: list[ModelMessage] = []
        eh: list[ModelMessage] = []

        async def send(user: str) -> str:
            plan = await run(planner, "planner", ph, user)
            return await run(executor, "executor", eh, fill(PROMPTS["executor_turn"], user=user, plan=plan))
    else:
        # multi_agent: the shopper hands off to the buyer; after the handoff, user turns go straight to the buyer.
        shopper, buyer = agent(PROMPTS["shopper"], store_toolsets()), agent(PROMPTS["buyer"], gateway_toolsets())
        sh: list[ModelMessage] = []
        bh: list[ModelMessage] = []
        state = {"handed_off": False}

        async def send(user: str) -> str:
            if state["handed_off"]:
                return await run(buyer, "buyer", bh, user)
            handoff = await run(shopper, "shopper", sh, user)
            state["handed_off"] = True
            return await run(buyer, "buyer", bh, fill(PROMPTS["buyer_turn"], user=user, handoff=handoff))

    class Session:
        async def send(self, user_text: str) -> str:
            requests_left["n"] = ctx.max_steps
            return await send(user_text)

        async def close(self) -> None:
            pass

    return Session()


FRAMEWORK = Framework(name="pydantic-ai", architectures=["single", "planner_executor", "multi_agent"], native_mcp=True,
                      requires_env="ANTHROPIC_API_KEY", provider="anthropic", create=create)
