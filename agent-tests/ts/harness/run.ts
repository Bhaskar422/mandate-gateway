// Run the TypeScript part of the matrix.
//   tsx harness/run.ts [--framework a,b] [--architecture single,...] [--scenario approve,...] [--model claude-haiku-5-5] [--concurrency 3]
import { FRAMEWORKS } from "../agents/index";
import { begin, finish, harnessStep } from "./lifecycle";
import { estimateCost, writeRun } from "./results";
import { LIMITS, SCENARIOS, type Scenario } from "./scenarios";
import { closeDb } from "./seed";
import { ARCHITECTURES, Recorder, StepLimitError, type Architecture, type Framework, type RunRecord } from "./types";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const listOpt = (name: string) => opt(name)?.split(",").map((s) => s.trim()).filter(Boolean);
const GATEWAY = (process.env.GATEWAY_URL ?? "http://localhost:3100").replace(/\/$/, "");
const DEFAULT_MODEL: Record<Framework["provider"], string> = { anthropic: "claude-haiku-5-5", openai: "gpt-5.1-mini", google: "gemini-2.5-flash" };

class TurnTimeout extends Error { constructor(ms: number) { super(`turn exceeded the ${Math.round(ms / 1000)}s wall-clock limit`); } }

async function runOne(fw: Framework, architecture: Architecture, model: string, sc: Scenario): Promise<RunRecord> {
  const base = { framework: fw.name, language: "ts" as const, architecture, model, scenario: sc.name, nativeMcp: fw.nativeMcp };
  const empty = { injection: null, toolCalls: [], modelCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 };
  if (!fw.architectures.includes(architecture)) return { ...base, ...empty, status: "skipped", reason: `skipped: ${fw.skipped?.[architecture] ?? "architecture not implemented for this framework"}` };
  if (!process.env[fw.requiresEnv]) return { ...base, ...empty, status: "skipped", reason: `skipped: ${fw.requiresEnv} not set` };

  const started = Date.now();
  const recorder = new Recorder();
  const finalTexts: string[] = [], harnessFailures: string[] = [];
  let agentProblem: { kind: "limit" | "error"; message: string } | null = null;
  let userId: string | null = null;
  let controller = new AbortController();
  try {
    const seeded = await begin(sc.name);
    userId = seeded.userId;
    const session = await fw.create({ architecture, model, gatewayUrl: GATEWAY, agentKey: seeded.agentKey, recorder, maxSteps: LIMITS.maxStepsPerTurn, signal: () => controller.signal });
    try {
      for (const step of sc.steps) {
        if (step.type === "harness") {
          const r = await harnessStep(userId, step.action);
          if (!r.ok) harnessFailures.push(`${step.action}: ${r.detail}`);
          continue;
        }
        controller = new AbortController();
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new TurnTimeout(LIMITS.turnTimeoutMs)); }, LIMITS.turnTimeoutMs); });
        try { finalTexts.push(await Promise.race([session.send(step.text), timeout])); }
        finally { clearTimeout(timer); }
      }
    } catch (e) {
      agentProblem = e instanceof StepLimitError || e instanceof TurnTimeout
        ? { kind: "limit", message: e.message } : { kind: "error", message: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
    } finally { await session.close?.().catch(() => {}); }
  } catch (e) {
    agentProblem = { kind: "error", message: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }

  // Always read the gateway's records and refund, whatever the agent did.
  let verdict: Awaited<ReturnType<typeof finish>> | null = null;
  if (userId) { try { verdict = await finish(sc.name, userId, recorder.toolCalls, finalTexts, harnessFailures); } catch (e) { agentProblem ??= { kind: "error", message: `harness: ${e instanceof Error ? e.message : e}` }; } }
  const status = agentProblem?.kind === "error" ? "error" : agentProblem ? "fail" : verdict!.status;
  const reason = agentProblem ? `${agentProblem.message}${verdict ? ` | gateway state: ${verdict.status}${verdict.reason ? ` (${verdict.reason})` : ""}` : ""}` : verdict!.reason;
  return {
    ...base, status, reason: reason.slice(0, 600), injection: verdict?.injection ?? null,
    toolCalls: recorder.toolCalls, modelCalls: recorder.modelCalls, inputTokens: recorder.inputTokens, outputTokens: recorder.outputTokens,
    costUsd: recorder.reportedCostUsd ?? estimateCost(model, recorder.inputTokens, recorder.outputTokens), durationMs: Date.now() - started,
    finalTexts: finalTexts.map((t) => t.slice(0, 1500)), purchases: verdict?.purchases, notes: verdict?.notes,
  };
}

async function main() {
  const fwFilter = listOpt("framework"), archFilter = listOpt("architecture") as Architecture[] | undefined, scFilter = listOpt("scenario");
  const concurrency = Number(opt("concurrency") ?? 3);
  const frameworks = FRAMEWORKS.filter((f) => !fwFilter || fwFilter.includes(f.name));
  if (fwFilter && frameworks.length !== fwFilter.length) throw new Error(`Unknown framework in ${fwFilter.join(",")}. Known: ${FRAMEWORKS.map((f) => f.name).join(", ")}`);
  const jobs: (() => Promise<RunRecord>)[] = [];
  for (const fw of frameworks) for (const a of ARCHITECTURES.filter((x) => !archFilter || archFilter.includes(x)))
    for (const sc of SCENARIOS.filter((s) => !scFilter || scFilter.includes(s.name)))
      jobs.push(() => runOne(fw, a, opt("model") ?? DEFAULT_MODEL[fw.provider], sc));

  let next = 0, failed = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length) {
      const r = await jobs[next++]();
      writeRun(r);
      if (r.status === "fail" || r.status === "error") failed++;
      const inj = r.injection ? ` injection=${r.injection}` : "";
      console.log(`${r.status.toUpperCase().padEnd(7)} ${r.framework} / ${r.architecture} / ${r.scenario} / ${r.model}  ${(r.durationMs / 1000).toFixed(1)}s $${r.costUsd.toFixed(4)} calls=${r.modelCalls} tools=${r.toolCalls.length}${inj}${r.reason ? `  — ${r.reason}` : ""}`);
    }
  }));
  await closeDb();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
