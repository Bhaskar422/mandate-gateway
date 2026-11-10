"""Run the Python part of the matrix.

    uv run python -m harness.run [--framework a,b] [--architecture single,...] [--scenario approve,...]
                                 [--model claude-haiku-5-5] [--concurrency 3]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from typing import Any

from frameworks import FRAMEWORKS
from .shared import LIMITS, RUNS_DIR, SCENARIOS, estimate_cost, harness, model_for
from .types import ARCHITECTURES, AgentContext, Framework, Recorder, StepLimitError, TurnTimeout

GATEWAY = os.environ.get("GATEWAY_URL", "http://localhost:3100").rstrip("/")


def _csv(v: str | None) -> list[str] | None:
    return [x.strip() for x in v.split(",") if x.strip()] if v else None


async def run_one(fw: Framework, architecture: str, model: str, sc: dict[str, Any]) -> dict[str, Any]:
    base = {"framework": fw.name, "language": "py", "architecture": architecture, "model": model, "scenario": sc["name"], "nativeMcp": fw.native_mcp}
    empty = {"injection": None, "toolCalls": [], "modelCalls": 0, "inputTokens": 0, "outputTokens": 0, "costUsd": 0, "durationMs": 0}
    if architecture not in fw.architectures:
        return {**base, **empty, "status": "skipped", "reason": f"skipped: {fw.skipped.get(architecture, 'architecture not implemented for this framework')}"}
    if not os.environ.get(fw.requires_env):
        return {**base, **empty, "status": "skipped", "reason": f"skipped: {fw.requires_env} not set"}

    started = time.monotonic()
    recorder = Recorder()
    final_texts: list[str] = []
    harness_failures: list[str] = []
    problem: tuple[str, str] | None = None  # ("limit" | "error", message)
    user_id: str | None = None
    try:
        seeded = await harness("begin", sc["name"])
        user_id = seeded["userId"]
        ctx = AgentContext(architecture=architecture, model=model, gateway_url=GATEWAY, agent_key=seeded["agentKey"], recorder=recorder,
                           max_steps=LIMITS["maxStepsPerTurn"], turn_timeout_s=LIMITS["turnTimeoutMs"] / 1000)
        session = await fw.create(ctx)
        try:
            for step in sc["steps"]:
                if step["type"] == "harness":
                    r = await harness("step", user_id, step["action"])
                    if not r["ok"]:
                        harness_failures.append(f"{step['action']}: {r['detail']}")
                    continue
                ctx.start_turn()
                try:
                    text = await asyncio.wait_for(session.send(step["text"]), timeout=ctx.turn_timeout_s)
                except asyncio.TimeoutError:
                    raise TurnTimeout(ctx.turn_timeout_s) from None
                final_texts.append(text or "")
                if ctx.limit_hit:
                    problem = ("limit", ctx.limit_hit)
                    break
        except (StepLimitError, TurnTimeout) as e:
            problem = ("limit", str(e))
        except Exception as e:  # noqa: BLE001 - any framework failure is an "error" result with the real reason
            problem = ("limit", ctx.limit_hit) if ctx.limit_hit else ("error", f"{type(e).__name__}: {e}")
        finally:
            try:
                await session.close()
            except Exception:  # noqa: BLE001
                pass
    except Exception as e:  # noqa: BLE001
        problem = ("error", f"{type(e).__name__}: {e}")

    # Always read the gateway's records and refund, whatever the agent did.
    verdict: dict[str, Any] | None = None
    if user_id:
        try:
            verdict = await harness("finish", sc["name"], user_id, stdin={"toolCalls": recorder.tool_calls, "finalTexts": final_texts, "harnessFailures": harness_failures})
        except Exception as e:  # noqa: BLE001
            problem = problem or ("error", f"harness: {e}")
    if problem:
        status = "error" if problem[0] == "error" else "fail"
        reason = problem[1] + (f" | gateway state: {verdict['status']}" + (f" ({verdict['reason']})" if verdict["reason"] else "") if verdict else "")
    else:
        status, reason = verdict["status"], verdict["reason"]  # type: ignore[index]
    reason = re.sub(r"mk_[A-Za-z0-9_-]+|sk-ant-[A-Za-z0-9_-]+", "<redacted>", reason)
    return {
        **base, "status": status, "reason": reason[:600], "injection": verdict["injection"] if verdict else None,
        "toolCalls": recorder.tool_calls, "modelCalls": recorder.model_calls, "inputTokens": recorder.input_tokens, "outputTokens": recorder.output_tokens,
        "costUsd": estimate_cost(model, recorder.input_tokens, recorder.output_tokens), "durationMs": round((time.monotonic() - started) * 1000),
        "finalTexts": [t[:1500] for t in final_texts], "purchases": verdict["purchases"] if verdict else None, "notes": verdict["notes"] if verdict else None,
    }


def write_run(r: dict[str, Any]) -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    key = re.sub(r"[^A-Za-z0-9_.-]", "-", "__".join([r["language"], r["framework"], r["architecture"], r["model"], r["scenario"]]))
    (RUNS_DIR / f"{key}.json").write_text(json.dumps({**r, "ranAt": datetime.now(timezone.utc).isoformat()}, indent=2))


async def main() -> None:
    ap = argparse.ArgumentParser()
    for name in ("framework", "architecture", "scenario", "model"):
        ap.add_argument(f"--{name}")
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--construct-only", action="store_true", help="build every agent without calling a model or the gateway (works without API keys)")
    a = ap.parse_args()
    fw_filter, arch_filter, sc_filter = _csv(a.framework), _csv(a.architecture), _csv(a.scenario)
    frameworks = [f for f in FRAMEWORKS if not fw_filter or f.name in fw_filter]
    if fw_filter and len(frameworks) != len(fw_filter):
        sys.exit(f"Unknown framework in {a.framework}. Known: {', '.join(f.name for f in FRAMEWORKS)}")
    if a.construct_only:
        failed = 0
        for fw in frameworks:
            for arch in fw.architectures:
                if arch_filter and arch not in arch_filter:
                    continue
                os.environ.setdefault(fw.requires_env, "not-a-real-key")  # constructing must not need a working key
                ctx = AgentContext(architecture=arch, model=model_for(fw.provider, a.model), gateway_url=GATEWAY, agent_key="mk_construct_only",
                                   recorder=Recorder(), max_steps=LIMITS["maxStepsPerTurn"], turn_timeout_s=LIMITS["turnTimeoutMs"] / 1000)
                try:
                    session = await fw.create(ctx)
                    await session.close()
                    print(f"OK      {fw.name} / {arch} constructs")
                except Exception as e:  # noqa: BLE001
                    failed += 1
                    print(f"ERROR   {fw.name} / {arch}: {type(e).__name__}: {e}")
        sys.exit(1 if failed else 0)
    jobs = [(fw, arch, model_for(fw.provider, a.model), sc)
            for fw in frameworks for arch in ARCHITECTURES if not arch_filter or arch in arch_filter
            for sc in SCENARIOS if not sc_filter or sc["name"] in sc_filter]
    sem = asyncio.Semaphore(a.concurrency)

    async def worker(job: tuple[Framework, str, str, dict[str, Any]]) -> None:
        async with sem:
            r = await run_one(*job)
        write_run(r)
        inj = f" injection={r['injection']}" if r["injection"] else ""
        print(f"{r['status'].upper():7} {r['framework']} / {r['architecture']} / {r['scenario']} / {r['model']}  {r['durationMs'] / 1000:.1f}s ${r['costUsd']:.4f} "
              f"calls={r['modelCalls']} tools={len(r['toolCalls'])}{inj}" + (f"  — {r['reason']}" if r["reason"] else ""), flush=True)

    await asyncio.gather(*(worker(j) for j in jobs))


if __name__ == "__main__":
    asyncio.run(main())
