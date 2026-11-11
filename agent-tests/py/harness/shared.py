"""Scenarios and prompts (shared JSON, same files the TypeScript side reads), pricing, and the bridge to
the TypeScript harness CLI, which owns all database seeding and all pass/fail rules."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]  # agent-tests/
_scenarios = json.loads((ROOT / "shared" / "scenarios.json").read_text())
SCENARIOS: list[dict[str, Any]] = _scenarios["scenarios"]
LIMITS: dict[str, int] = _scenarios["limits"]
PROMPTS: dict[str, str] = json.loads((ROOT / "shared" / "prompts.json").read_text())
RUNS_DIR = ROOT / "results" / "runs"

# USD per million tokens (input, output).
PRICES = {
    "claude-haiku-5-5": (0.1, 0.5),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-opus-5-5": (4.0, 20.0),
}
DEFAULT_MODEL = {
    "anthropic": "claude-haiku-5-5",
    "openai": os.environ.get("AGENT_TESTS_OPENAI_MODEL", "gpt-5-mini"),
    "google": os.environ.get("AGENT_TESTS_GOOGLE_MODEL", "gemini-flash-latest"),
}


def provider_of(model: str) -> str:
    return "anthropic" if model.startswith("claude") else "google" if model.startswith("gemini") else "openai"


def model_for(provider: str, requested: str | None) -> str:
    """--model applies to the frameworks that can drive it; the others keep their provider's default."""
    return requested if requested and provider_of(requested) == provider else DEFAULT_MODEL[provider]


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    p = PRICES.get(model)
    return round((input_tokens * p[0] + output_tokens * p[1]) / 1e6, 6) if p else 0.0


def fill(template: str, **values: str) -> str:
    out = template
    for k, v in values.items():
        out = out.replace("{" + k + "}", v)
    return out


async def harness(*args: str, stdin: dict[str, Any] | None = None) -> dict[str, Any]:
    """Call the TypeScript harness CLI (ts/harness/cli.ts): begin | step | finish."""
    proc = await asyncio.create_subprocess_exec(
        "pnpm", "exec", "tsx", "harness/cli.ts", *args, cwd=str(ROOT / "ts"), env=os.environ.copy(),
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await proc.communicate(json.dumps(stdin).encode() if stdin is not None else b"")
    if proc.returncode != 0:
        raise RuntimeError(f"harness {' '.join(args[:1])} failed: {err.decode()[-600:]}")
    return json.loads(out.decode().strip().splitlines()[-1])
