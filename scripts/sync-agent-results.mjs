// Copy the agent test results into the app, without the per-run tool traces (they stay in agent-tests/results).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const d = JSON.parse(readFileSync("agent-tests/results/latest.json", "utf8"));
const runs = d.runs.map(({ toolCalls, notes: _notes, ...r }) => ({ ...r, toolCallCount: Array.isArray(toolCalls) ? toolCalls.length : null, reason: r.reason ? String(r.reason).slice(0, 300) : null }));
writeFileSync("src/data/agent-results.json", JSON.stringify({ generatedAt: d.generatedAt, gateway: d.gateway, runs }, null, 1) + "\n");
console.log(`synced ${runs.length} runs`);

// The baseline comparison (the same agents without the gateway): only the summary that agent-tests' report computed.
const baselineFile = "agent-tests/results/baseline.json";
const comparison = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, "utf8")).comparison : null;
if (comparison) {
  const { leaks: _leaks, ...summary } = comparison;
  writeFileSync("src/data/agent-baseline.json", JSON.stringify(summary, null, 1) + "\n");
  console.log(`synced the baseline comparison (${summary.conditions.map((c) => `${c.key}: ${c.runs} runs`).join(", ")})`);
} else console.log("no baseline comparison to sync (run agent-tests/run-baseline.sh, which also rebuilds the report)");
