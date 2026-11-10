"""The one place (for Python) that knows how to reach the gateway and store MCP servers and how the six
tools are described to a model. Framework adapters wrap these as native function tools.

`TOOL_SPECS` holds name, description and JSON schema. `build_functions` returns plain typed Python
functions (sync or async) for frameworks that derive tool schemas from signatures and docstrings.
"""

import itertools
import json
import time
from dataclasses import dataclass
from typing import Any, Callable, Literal

import httpx

from .types import AgentContext, StepLimitError, TurnTimeout

STORES = ("stride", "kickz")
_rpc_id = itertools.count(1)


def mcp_urls(gateway_url: str) -> dict[str, str]:
    return {"gateway": f"{gateway_url}/api/mcp", "stride": f"{gateway_url}/stores/stride/mcp", "kickz": f"{gateway_url}/stores/kickz/mcp"}


def _parse(status: int, text: str) -> str:
    if status >= 400:
        return json.dumps({"error": f"HTTP {status}", "body": text[:500]})
    line = text if text.startswith("{") else next((l[5:] for l in text.split("\n") if l.startswith("data:")), "")
    try:
        data = json.loads(line)
    except ValueError:
        return json.dumps({"error": "unparseable MCP response", "body": text[:500]})
    if data.get("error"):
        return json.dumps({"error": data["error"]})
    return "\n".join(c.get("text", "") for c in data.get("result", {}).get("content", []))


def _request(url: str, name: str, args: dict[str, Any], key: str | None) -> dict[str, Any]:
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return {"url": url, "headers": headers, "json": {"jsonrpc": "2.0", "id": next(_rpc_id), "method": "tools/call", "params": {"name": name, "arguments": args}}}


def mcp_call(url: str, name: str, args: dict[str, Any], key: str | None = None, timeout: float = 90) -> str:
    """Bare JSON-RPC `tools/call` against a stateless Streamable HTTP MCP server. Returns the tool's text result."""
    r = httpx.post(**_request(url, name, args, key), timeout=timeout)
    return _parse(r.status_code, r.text)


async def mcp_call_async(url: str, name: str, args: dict[str, Any], key: str | None = None, timeout: float = 90) -> str:
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(**_request(url, name, args, key))
    return _parse(r.status_code, r.text)


_STORE = {"type": "string", "enum": list(STORES), "description": 'Which store: "stride" (Stride Running Co.) or "kickz" (Kickz Outlet)'}

TOOL_SPECS: list[dict[str, Any]] = [
    {"name": "search_products", "group": "store",
     "description": "Search a store's catalogue. Returns products with prices and product page URLs.",
     "parameters": {"type": "object", "properties": {"store": _STORE, "query": {"type": "string", "description": "Search terms; empty returns everything", "default": ""}}, "required": ["store"]}},
    {"name": "get_product", "group": "store",
     "description": "Full details for one product in a store's catalogue.",
     "parameters": {"type": "object", "properties": {"store": _STORE, "sku": {"type": "string"}}, "required": ["store", "sku"]}},
    {"name": "get_mandate", "group": "gateway",
     "description": "Read what the user has authorised you to buy: budget remaining, allowed categories, merchant rules, approval threshold and expiry. Call this before shopping.",
     "parameters": {"type": "object", "properties": {}}},
    {"name": "request_purchase", "group": "gateway",
     "description": "Ask the gateway to buy one product for the user with their PayPal account. You never handle payment details. The gateway reads the product page itself, checks the purchase against the user's mandate, and then pays, asks the user, or blocks it with a reason.",
     "parameters": {"type": "object", "properties": {
         "product_url": {"type": "string", "description": "The product page URL on the merchant's site"},
         "quantity": {"type": "integer", "minimum": 1, "maximum": 20, "default": 1},
         "expected_price": {"type": "number", "exclusiveMinimum": 0, "description": "The unit price you saw, in the product's currency, e.g. 89.00"},
         "user_request": {"type": "string", "minLength": 3, "description": "What the user asked you for, in their own words"},
         "reason": {"type": "string", "description": "Why this product fits the request"}},
         "required": ["product_url", "expected_price", "user_request"]}},
    {"name": "check_status", "group": "gateway",
     "description": "Get the current status of a purchase you requested, e.g. after the user approves one.",
     "parameters": {"type": "object", "properties": {"purchase_id": {"type": "string"}}, "required": ["purchase_id"]}},
    {"name": "report_problem", "group": "gateway",
     "description": "Tell the gateway something went wrong with a completed purchase (wrong item, not received, damaged). The gateway sends the merchant the signed record of what was ordered and pursues a refund.",
     "parameters": {"type": "object", "properties": {"purchase_id": {"type": "string"}, "description": {"type": "string", "minLength": 5, "description": "What the user says went wrong, in their own words"}}, "required": ["purchase_id", "description"]}},
]
SPEC = {s["name"]: s for s in TOOL_SPECS}


def specs_for(*groups: str) -> list[dict[str, Any]]:
    return [s for s in TOOL_SPECS if s["group"] in groups]


@dataclass
class ToolEnv:
    ctx: AgentContext
    agent: str | None = None


def _route(name: str, args: dict[str, Any], env: ToolEnv) -> tuple[str, dict[str, Any], str | None]:
    """Record the call, enforce the per-turn caps, and work out which MCP server it goes to."""
    env.ctx.recorder.tool(name, args, env.agent)
    env.ctx.turn_tool_calls += 1
    # Frameworks may swallow exceptions raised by tools, so the limit is also flagged on the context for the runner.
    if env.ctx.turn_tool_calls > env.ctx.max_steps:
        env.ctx.limit_hit = str(StepLimitError(env.ctx.max_steps))
        raise StepLimitError(env.ctx.max_steps)
    if env.ctx.deadline and time.monotonic() > env.ctx.deadline:
        env.ctx.limit_hit = str(TurnTimeout(env.ctx.turn_timeout_s))
        raise TurnTimeout(env.ctx.turn_timeout_s)
    urls = mcp_urls(env.ctx.gateway_url)
    if SPEC[name]["group"] == "store":
        store = args.get("store")
        if store not in STORES:
            raise ValueError(f'store must be one of {", ".join(STORES)}')
        return urls[store], {k: v for k, v in args.items() if k != "store"}, None
    return urls["gateway"], args, env.ctx.agent_key


def call_tool(name: str, args: dict[str, Any], env: ToolEnv) -> str:
    try:
        url, a, key = _route(name, args, env)
        return mcp_call(url, name, a, key)
    except (StepLimitError, TurnTimeout):
        raise
    except Exception as e:  # tool errors go back to the model as data
        return json.dumps({"error": str(e)})


async def call_tool_async(name: str, args: dict[str, Any], env: ToolEnv) -> str:
    try:
        url, a, key = _route(name, args, env)
        return await mcp_call_async(url, name, a, key)
    except (StepLimitError, TurnTimeout):
        raise
    except Exception as e:
        return json.dumps({"error": str(e)})


def _drop_none(**kw: Any) -> dict[str, Any]:
    return {k: v for k, v in kw.items() if v is not None}


def build_functions(env: ToolEnv, *groups: str, use_async: bool = True) -> list[Callable[..., Any]]:
    """Typed Python functions for the tools in `groups`. Docstrings are the tool descriptions."""
    if use_async:
        async def search_products(store: Literal["stride", "kickz"], query: str = "") -> str:
            return await call_tool_async("search_products", {"store": store, "query": query}, env)

        async def get_product(store: Literal["stride", "kickz"], sku: str) -> str:
            return await call_tool_async("get_product", {"store": store, "sku": sku}, env)

        async def get_mandate() -> str:
            return await call_tool_async("get_mandate", {}, env)

        async def request_purchase(product_url: str, expected_price: float, user_request: str, quantity: int = 1, reason: str | None = None) -> str:
            return await call_tool_async("request_purchase", _drop_none(product_url=product_url, expected_price=expected_price, user_request=user_request, quantity=quantity, reason=reason), env)

        async def check_status(purchase_id: str) -> str:
            return await call_tool_async("check_status", {"purchase_id": purchase_id}, env)

        async def report_problem(purchase_id: str, description: str) -> str:
            return await call_tool_async("report_problem", {"purchase_id": purchase_id, "description": description}, env)
    else:
        def search_products(store: Literal["stride", "kickz"], query: str = "") -> str:  # type: ignore[misc]
            return call_tool("search_products", {"store": store, "query": query}, env)

        def get_product(store: Literal["stride", "kickz"], sku: str) -> str:  # type: ignore[misc]
            return call_tool("get_product", {"store": store, "sku": sku}, env)

        def get_mandate() -> str:  # type: ignore[misc]
            return call_tool("get_mandate", {}, env)

        def request_purchase(product_url: str, expected_price: float, user_request: str, quantity: int = 1, reason: str | None = None) -> str:  # type: ignore[misc]
            return call_tool("request_purchase", _drop_none(product_url=product_url, expected_price=expected_price, user_request=user_request, quantity=quantity, reason=reason), env)

        def check_status(purchase_id: str) -> str:  # type: ignore[misc]
            return call_tool("check_status", {"purchase_id": purchase_id}, env)

        def report_problem(purchase_id: str, description: str) -> str:  # type: ignore[misc]
            return call_tool("report_problem", {"purchase_id": purchase_id, "description": description}, env)

    arg_docs = {
        "search_products": 'store: Which store, "stride" (Stride Running Co.) or "kickz" (Kickz Outlet).\n    query: Search terms; empty returns everything.',
        "get_product": 'store: Which store, "stride" (Stride Running Co.) or "kickz" (Kickz Outlet).\n    sku: The product SKU.',
        "get_mandate": "",
        "request_purchase": "product_url: The product page URL on the merchant's site.\n    expected_price: The unit price you saw, in the product's currency, e.g. 89.00.\n    user_request: What the user asked you for, in their own words.\n    quantity: How many to buy, 1 to 20.\n    reason: Why this product fits the request.",
        "check_status": "purchase_id: The purchase id returned by request_purchase.",
        "report_problem": "purchase_id: The purchase id returned by request_purchase.\n    description: What the user says went wrong, in their own words.",
    }
    out = []
    for fn in (search_products, get_product, get_mandate, request_purchase, check_status, report_problem):
        spec = SPEC[fn.__name__]
        if spec["group"] not in groups:
            continue
        fn.__doc__ = spec["description"] + (f"\n\nArgs:\n    {arg_docs[fn.__name__]}" if arg_docs[fn.__name__] else "")
        out.append(fn)
    return out


def canonical_tool_call(raw_name: str, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Normalise an MCP-client tool name (e.g. "stride_search_products") to the trace's canonical form."""
    for prefix in ("mcp__", ""):
        for server in ("stride", "kickz", "gateway", "mandate"):
            for sep in ("__", "_", "-"):
                p = f"{prefix}{server}{sep}"
                if raw_name.startswith(p):
                    tool = raw_name[len(p):]
                    return (tool, {"store": server, **args}) if server in STORES else (tool, args)
    return raw_name, args
