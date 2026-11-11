"""Framework 9: Google ADK with a Gemini model. Skipped unless GOOGLE_API_KEY is set.

- single:           one LlmAgent with the six function tools.
- planner_executor: a tool-less planner LlmAgent, then an executor LlmAgent (two runners).
- multi_agent:      ADK's native agent transfer: the shopper LlmAgent has the buyer as a sub-agent and
                    transfers to it; the session keeps the active agent for follow-up turns.
"""
from __future__ import annotations

import uuid
from typing import Any

from google.adk.agents import LlmAgent
from google.adk.agents.run_config import RunConfig
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from harness.shared import PROMPTS, fill
from harness.tools import ToolEnv, build_functions
from harness.types import AgentContext, Framework, StepLimitError

APP = "mandate_agent_tests"


async def create(ctx: AgentContext):
    def tools(agent: str, *groups: str) -> list[Any]:
        return build_functions(ToolEnv(ctx, agent), *groups)  # ADK wraps plain (async) functions as FunctionTools

    class Conversation:
        """One ADK runner + session: a persistent conversation rooted at `agent`."""

        def __init__(self, agent: LlmAgent):
            self.sessions = InMemorySessionService()
            self.runner = Runner(agent=agent, app_name=APP, session_service=self.sessions)
            self.session_id: str | None = None

        async def send(self, text: str) -> str:
            if self.session_id is None:
                self.session_id = str(uuid.uuid4())
                await self.sessions.create_session(app_name=APP, user_id="user", session_id=self.session_id)
            final, calls = "", 0
            message = types.Content(role="user", parts=[types.Part(text=text)])
            async for event in self.runner.run_async(user_id="user", session_id=self.session_id, new_message=message,
                                                     run_config=RunConfig(max_llm_calls=ctx.max_steps)):
                if event.usage_metadata:
                    calls += 1
                    if calls > ctx.max_steps:
                        raise StepLimitError(ctx.max_steps)
                    ctx.recorder.usage(event.usage_metadata.prompt_token_count, event.usage_metadata.candidates_token_count)
                if event.is_final_response() and event.content and event.content.parts:
                    final = "".join(p.text or "" for p in event.content.parts).strip() or final
            return final

    if ctx.architecture == "single":
        c = Conversation(LlmAgent(name="shopping_assistant", model=ctx.model, instruction=PROMPTS["system"], tools=tools("agent", "store", "gateway")))

        async def send(user: str) -> str:
            return await c.send(user)
    elif ctx.architecture == "planner_executor":
        planner = Conversation(LlmAgent(name="planner", model=ctx.model, instruction=PROMPTS["planner"]))
        executor = Conversation(LlmAgent(name="executor", model=ctx.model, instruction=f"{PROMPTS['system']}\n\n{PROMPTS['executor_suffix']}", tools=tools("executor", "store", "gateway")))

        async def send(user: str) -> str:
            plan = await planner.send(user)
            return await executor.send(fill(PROMPTS["executor_turn"], user=user, plan=plan))
    else:
        buyer = LlmAgent(name="buyer", model=ctx.model, instruction=PROMPTS["buyer"], tools=tools("buyer", "gateway"),
                         description="Pays for a product through the Mandate payment gateway, checks purchases and reports problems.")
        shopper = LlmAgent(name="shopper", model=ctx.model, instruction=f"{PROMPTS['shopper']}\n\n{PROMPTS['shopper_transfer_suffix']}", tools=tools("shopper", "store"), sub_agents=[buyer],
                           description="Finds products in the Stride Running Co. and Kickz Outlet catalogues. Cannot pay.")
        c = Conversation(shopper)

        async def send(user: str) -> str:
            return await c.send(user)

    class Session:
        async def send(self, user_text: str) -> str:
            return await send(user_text)

        async def close(self) -> None:
            pass

    return Session()


FRAMEWORK = Framework(name="google-adk", architectures=["single", "planner_executor", "multi_agent"], native_mcp=False,
                      requires_env="GOOGLE_API_KEY", provider="google", create=create)
