// Copy the agent test results into the app, without the per-run tool traces (they stay in agent-tests/results).
import { readFileSync, writeFileSync } from "node:fs";
const d = JSON.parse(readFileSync("agent-tests/results/latest.json", "utf8"));
const runs = d.runs.map(({ toolCalls, notes: _notes, ...r }) => ({ ...r, toolCallCount: Array.isArray(toolCalls) ? toolCalls.length : null, reason: r.reason ? String(r.reason).slice(0, 300) : null }));
writeFileSync("src/data/agent-results.json", JSON.stringify({ generatedAt: d.generatedAt, gateway: d.gateway, runs }, null, 1) + "\n");
console.log(`synced ${runs.length} runs`);
