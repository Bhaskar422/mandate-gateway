"""Shared types for the Python agents. Mirrors ts/harness/types.ts."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol

ARCHITECTURES = ["single", "planner_executor", "multi_agent"]


class StepLimitError(Exception):
    def __init__(self, max_steps: int):
        super().__init__(f"step limit reached ({max_steps} steps in one turn)")


class TurnTimeout(Exception):
    def __init__(self, seconds: float):
        super().__init__(f"turn exceeded the {round(seconds)}s wall-clock limit")


@dataclass
class Recorder:
    """Collects what an agent did. Shared by every framework adapter."""

    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    model_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0

    def tool(self, name: str, args: Any, agent: str | None = None) -> None:
        call: dict[str, Any] = {"tool": name, "args": args if isinstance(args, dict) else {}}
        if agent:
            call["agent"] = agent
        self.tool_calls.append(call)

    def usage(self, input_tokens: int | None, output_tokens: int | None, calls: int = 1) -> None:
        self.model_calls += calls
        self.input_tokens += input_tokens or 0
        self.output_tokens += output_tokens or 0


@dataclass
class AgentContext:
    architecture: str
    model: str
    gateway_url: str
    agent_key: str
    recorder: Recorder
    max_steps: int
    turn_timeout_s: float
    # Wall-clock deadline (time.monotonic) of the current user turn; the runner sets it before each send().
    deadline: float = 0.0
    # Tool calls made in the current turn; tools refuse to run past max_steps or the deadline.
    turn_tool_calls: int = 0
    # Set when a tool refused to run because a cap was hit (frameworks may swallow the exception).
    limit_hit: str | None = None

    def start_turn(self) -> None:
        self.deadline = time.monotonic() + self.turn_timeout_s
        self.turn_tool_calls = 0


class AgentSession(Protocol):
    async def send(self, user_text: str) -> str: ...
    async def close(self) -> None: ...


@dataclass
class Framework:
    name: str
    architectures: list[str]
    native_mcp: bool
    requires_env: str
    provider: str  # "anthropic" | "openai" | "google"
    create: Callable[[AgentContext], Awaitable[AgentSession]]
    skipped: dict[str, str] = field(default_factory=dict)
