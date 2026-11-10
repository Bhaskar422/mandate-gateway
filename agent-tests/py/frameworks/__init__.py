"""Registry of Python frameworks. To add one: write frameworks/<name>_agent.py exposing FRAMEWORK, add it here.
(The package is called `frameworks`, not `agents`, because the OpenAI Agents SDK's module is named `agents`.)"""
from harness.types import Framework

from .crewai_agent import FRAMEWORK as crewai
from .langgraph_agent import FRAMEWORK as langgraph_py
from .pydantic_ai_agent import FRAMEWORK as pydantic_ai

FRAMEWORKS: list[Framework] = [langgraph_py, crewai, pydantic_ai]
