// Registry of TypeScript frameworks. To add one: write agents/<name>.ts exporting a Framework, add it here.
import type { Framework } from "../harness/types";
import { anthropicSdk } from "./anthropic-sdk";
import { claudeAgentSdk } from "./claude-agent-sdk";
import { langgraphJs } from "./langgraph-js";
import { vercelAiSdk } from "./vercel-ai-sdk";

export const FRAMEWORKS: Framework[] = [anthropicSdk, claudeAgentSdk, vercelAiSdk, langgraphJs];
