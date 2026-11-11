// Copy the agent test results into the app (run from the repo root):
//   src/data/agent-results.json        one row per gateway run: verdict, reason, notes, counts (no traces)
//   src/data/agent-run-details.json    per-run detail for the test explorer, loaded only when a row is opened: the tool
//                                      calls in order (arguments capped), the agent's final messages (capped) and the
//                                      gateway's purchase rows. Read from agent-tests/results/runs/*.json when those
//                                      files are present (they are git-ignored); otherwise only the tool calls, from latest.json.
//   src/data/agent-scenarios.json      the scenario definitions (user turns, harness steps, mandate limit, caps)
//   src/data/agent-baseline.json       the baseline comparison computed by agent-tests' report
//   src/data/agent-baseline-runs.json  one row per baseline run: what was ordered, inside or outside the mandate
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const CAP = { args: 300, text: 1000, tools: 40, reason: 300 };
/** Nothing that looks like a model API key or an agent key may reach the app's data files. */
const redact = (s) => String(s).replace(/sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{8,}|mk_[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}/g, "<redacted>");
const cap = (s, n) => { const t = redact(s ?? ""); return t.length > n ? `${t.slice(0, n)} …` : t; };
const write = (file, data) => writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
const tools = (calls) => (Array.isArray(calls) ? calls : []).slice(0, CAP.tools).map((c) => ({ tool: String(c.tool), ...(c.agent ? { agent: String(c.agent) } : {}), args: cap(JSON.stringify(c.args ?? {}), CAP.args) }));
const runId = (r) => `${r.framework}|${r.architecture}|${r.model}|${r.scenario}`;

// ---- gateway runs ----
const d = JSON.parse(readFileSync("agent-tests/results/latest.json", "utf8"));
const RUNS_DIR = "agent-tests/results/runs/";
const full = new Map((existsSync(RUNS_DIR) ? readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json")) : []).map((f) => { const r = JSON.parse(readFileSync(RUNS_DIR + f, "utf8")); return [runId(r), r]; }));
const runs = d.runs.map(({ toolCalls, notes, ...r }) => ({
  id: runId(r), ...r, toolCallCount: Array.isArray(toolCalls) ? toolCalls.length : null, reason: r.reason ? cap(r.reason, CAP.reason) : null,
  notes: (notes ?? []).map((n) => cap(n, CAP.reason)), ...(full.has(runId(r)) ? { nativeMcp: Boolean(full.get(runId(r)).nativeMcp) } : {}),
}));
write("src/data/agent-results.json", { generatedAt: d.generatedAt, gateway: d.gateway, runs });
const withFull = d.runs.filter((r) => full.has(runId(r))).length;
const gatewayDetails = Object.fromEntries(d.runs.map((r) => {
  const f = full.get(runId(r));
  return [runId(r), {
    tools: tools(r.toolCalls), toolsDropped: Math.max(0, (r.toolCalls?.length ?? 0) - CAP.tools),
    ...(f ? {
      finalTexts: (f.finalTexts ?? []).map((t) => cap(t, CAP.text)), ranAt: f.ranAt ?? null,
      purchases: (f.purchases ?? []).map((p) => ({ status: String(p.status), sku: p.sku ?? null, productName: p.productName ?? null, amountCents: Number(p.amountCents ?? 0), captured: Boolean(p.captured), decisionReason: p.decisionReason ? cap(p.decisionReason, CAP.reason) : null })),
    } : {}),
  }];
}));
console.log(`synced ${runs.length} gateway runs (${withFull} with final messages and purchase rows from results/runs/, ${runs.length - withFull} with tool calls only)`);

// ---- scenario definitions ----
write("src/data/agent-scenarios.json", JSON.parse(readFileSync("agent-tests/shared/scenarios.json", "utf8")));

// ---- baseline (the same agents without the gateway) ----
const baselineFile = "agent-tests/results/baseline.json";
const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, "utf8")) : null;
const baselineDetails = {};
if (baseline?.comparison) {
  write("src/data/agent-baseline.json", baseline.comparison);
  const id = (r) => `${r.architecture ?? "single"}|${r.condition}|${r.model}|${r.scenario}|${r.run}`;
  const rows = baseline.runs.map((r) => ({
    id: id(r), architecture: r.architecture ?? "single", condition: r.condition, model: r.model, scenario: r.scenario, run: r.run, status: r.status, problem: r.problem ? cap(r.problem, CAP.reason) : null,
    outsideCents: r.outsideCents, requestedOrdered: r.requestedOrdered,
    orders: r.orders.map((o) => ({ totalCents: o.totalCents, outside: o.outside, reasons: o.reasons.map((x) => cap(x, CAP.reason)), items: o.items.map((it) => ({ name: cap(it.name, 120), quantity: it.quantity, unitCents: it.unitCents, sku: it.sku ?? null })) })),
    toolCallCount: r.toolCalls.length, modelCalls: r.modelCalls, durationMs: r.durationMs,
  }));
  for (const r of baseline.runs) baselineDetails[id(r)] = { tools: tools(r.toolCalls), toolsDropped: Math.max(0, r.toolCalls.length - CAP.tools), finalTexts: r.finalText ? [cap(r.finalText, CAP.text)] : [], ...(r.between ? { between: cap(r.between, CAP.text) } : {}), ranAt: r.ranAt ?? null };
  write("src/data/agent-baseline-runs.json", { ranAt: baseline.generatedAt, runs: rows });
  console.log(`synced the baseline comparison (${baseline.comparison.conditions.map((c) => `${c.key}: ${c.runs} runs`).join(", ")}) and ${rows.length} baseline runs`);
} else console.log("no baseline comparison to sync (run agent-tests/run-baseline.sh, which also rebuilds the report)");

// One run per line: the file is loaded by the browser, so it is not indented.
const lines = (o) => `{\n${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(",\n")}\n}`;
writeFileSync("src/data/agent-run-details.json", `{"caps":${JSON.stringify(CAP)},\n"gateway":${lines(gatewayDetails)},\n"baseline":${lines(baselineDetails)}}\n`);
