// Pricing and per-run result files. Each run writes results/runs/<key>.json; harness/report.ts merges them.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RunRecord } from "./types";

/** USD per million tokens (input, output). Used when the framework does not report cost itself. */
export const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model];
  return p ? Number(((inputTokens * p[0] + outputTokens * p[1]) / 1e6).toFixed(6)) : 0;
}

export const RESULTS_DIR = fileURLToPath(new URL("../../results/", import.meta.url));
export const RUNS_DIR = `${RESULTS_DIR}runs/`;
export const runKey = (r: Pick<RunRecord, "language" | "framework" | "architecture" | "model" | "scenario">) =>
  [r.language, r.framework, r.architecture, r.model, r.scenario].join("__").replace(/[^A-Za-z0-9_.-]/g, "-");
export function writeRun(r: RunRecord) {
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(`${RUNS_DIR}${runKey(r)}.json`, JSON.stringify({ ...r, ranAt: new Date().toISOString() }, null, 2));
}
