"""Framework 6: CrewAI. Agents, tasks and crews, with the six tools as CrewAI tools.

- single:           one agent, one task.
- planner_executor: CrewAI's own planning step (`Crew(planning=True)`): a tool-less planner writes the plan
                    that is appended to the task before the agent executes it.
- multi_agent:      a two-agent sequential crew: the shopper's task output is the context of the buyer's task.

A crew run is stateless, so each user turn is a fresh kickoff whose task carries the conversation so far
(earlier user messages, the assistant's replies and the tool results it saw).
"""
from __future__ import annotations

import asyncio
import functools
import os

os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")  # never send run data to third parties
os.environ.setdefault("CREWAI_TRACING_ENABLED", "false")
os.environ.setdefault("OTEL_SDK_DISABLED", "true")

from crewai import LLM, Agent, Crew, Process, Task  # noqa: E402
from crewai.tools import tool as crewai_tool  # noqa: E402

from harness.shared import PROMPTS  # noqa: E402
from harness.tools import ToolEnv, build_functions  # noqa: E402
from harness.types import AgentContext, Framework, StepLimitError  # noqa: E402

EXPECTED = "A plain statement to the user of what happened."


async def create(ctx: AgentContext):
    llm = LLM(model=f"anthropic/{ctx.model}", max_tokens=8000)
    transcript: list[str] = []  # the conversation so far, replayed into each kickoff
    tool_log: list[str] = []

    def tools(agent: str, *groups: str):
        def logged(fn):
            @functools.wraps(fn)
            def wrapper(*args, **kwargs):
                result = fn(*args, **kwargs)
                tool_log.append(f"{fn.__name__}({kwargs or args}) -> {result}")
                return result
            return wrapper

        out = [crewai_tool(fn.__name__)(logged(fn)) for fn in build_functions(ToolEnv(ctx, agent), *groups, use_async=False)]
        return out

    def agent(role: str, prompt: str, *groups: str) -> Agent:
        return Agent(role=role, goal="Do what the user asks, on their behalf.", backstory=prompt, llm=llm, tools=tools(role, *groups),
                     max_iter=ctx.max_steps, allow_delegation=False, verbose=False)

    def describe(user: str) -> str:
        if not transcript:
            return f"The user says: {user}"
        return "Conversation so far:\n" + "\n".join(transcript) + f"\n\nThe user now says: {user}"

    def kickoff(crew: Crew) -> str:
        out = crew.kickoff()
        u = crew.usage_metrics
        if u:
            ctx.recorder.usage(u.prompt_tokens, u.completion_tokens, u.successful_requests)
        return str(out.raw).strip()

    handed_off = {"v": False}

    def run_turn(user: str) -> str:
        n_before = len(tool_log)
        if ctx.architecture == "multi_agent":
            buyer = agent("Buyer", PROMPTS["buyer"], "gateway")
            buy = Task(description=describe(user), expected_output=EXPECTED, agent=buyer)
            if handed_off["v"]:  # after the handoff the buyer owns the conversation
                crew = Crew(agents=[buyer], tasks=[buy], process=Process.sequential, verbose=False)
            else:
                shopper = agent("Shopper", PROMPTS["shopper"], "store")
                find = Task(description=describe(user), agent=shopper,
                            expected_output="A handoff for the buyer: the product name, the product page URL, the unit price and anything else the buyer needs to know.")
                buy.context = [find]
                crew = Crew(agents=[shopper, buyer], tasks=[find, buy], process=Process.sequential, verbose=False)
                handed_off["v"] = True
        else:
            a = agent("Shopping assistant", PROMPTS["system"], "store", "gateway")
            planning = ctx.architecture == "planner_executor"
            crew = Crew(agents=[a], tasks=[Task(description=describe(user), expected_output=EXPECTED, agent=a)], process=Process.sequential, verbose=False,
                        **({"planning": True, "planning_llm": llm} if planning else {}))
        text = kickoff(crew)
        transcript.append(f"User: {user}")
        transcript.extend(f"Tool result: {entry}" for entry in tool_log[n_before:])
        transcript.append(f"Assistant: {text}")
        return text

    class Session:
        async def send(self, user_text: str) -> str:
            text = await asyncio.to_thread(run_turn, user_text)
            if ctx.limit_hit:
                raise StepLimitError(ctx.max_steps)
            return text

        async def close(self) -> None:
            pass

    return Session()


FRAMEWORK = Framework(name="crewai", architectures=["single", "planner_executor", "multi_agent"], native_mcp=False,
                      requires_env="ANTHROPIC_API_KEY", provider="anthropic", create=create)
