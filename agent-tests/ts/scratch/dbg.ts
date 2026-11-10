import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const env: Record<string,string> = {}; for (const [k,v] of Object.entries(process.env)) if (v && !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_|ANTHROPIC_BASE_URL$)/.test(k)) env[k]=v;
const stores = { stride: { type: "http" as const, url: "http://localhost:3100/stores/stride/mcp" } };
const mode = process.argv[2];
async function* one() { yield { type: "user" as const, message: { role: "user" as const, content: "Use the shopper subagent to find the Tempo 3 at Stride and report its price." }, parent_tool_use_id: null }; await new Promise((r) => setTimeout(r, 60000)); }
const q = query({ prompt: process.argv[3] === "stream" ? one() : "Use the shopper subagent to find the Tempo 3 at Stride and report its price.", options: {
  model: "claude-haiku-5-5", cwd: mkdtempSync(join(tmpdir(), "dbg-")), env, settingSources: [], strictMcpConfig: mode !== "nostrict", persistSession: false, maxTurns: 6,
  tools: ["Agent"], permissionMode: "dontAsk", allowedTools: ["Agent", "mcp__stride"],
  ...(mode === "top" ? { mcpServers: stores } : {}),
  agents: { shopper: { description: "Finds products in the Stride catalogue.", prompt: "You find products.", model: "inherit",
    ...(mode === "top" ? {} : { mcpServers: [stores] }), tools: ["mcp__stride__search_products", "mcp__stride__get_product"] } } } });
for await (const m of q as AsyncIterable<any>) {
  if (m.type === "system" && m.subtype === "init") console.log("INIT tools", m.tools, "mcp", m.mcp_servers, "agents", m.agents);
  else if (m.type === "assistant") console.log("A", m.parent_tool_use_id ? "(sub)" : "", JSON.stringify(m.message.content).slice(0, 400));
  else if (m.type === "user") console.log("U", m.parent_tool_use_id ? "(sub)" : "", JSON.stringify(m.message.content).slice(0, 600));
  else if (m.type === "result") { console.log("RESULT", m.subtype, m.result?.slice(0, 300)); process.exit(0); }
}
