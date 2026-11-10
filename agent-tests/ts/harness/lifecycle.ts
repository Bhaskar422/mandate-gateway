// What happens around the agent in every run, in either language: seed, harness steps, verdict, cleanup.
import { approvePending, cleanup, purchasesFor, seedUser, shipWrongItem } from "./seed";
import { evaluate, scenario } from "./scenarios";
import type { ToolCall } from "./types";

export async function begin(scenarioName: string) {
  const s = scenario(scenarioName);
  return seedUser(s.name, s.mandateLimitCents);
}

export async function harnessStep(userId: string, action: string): Promise<{ ok: boolean; detail: string }> {
  if (action === "approve_pending") return approvePending(userId);
  if (action === "ship_wrong_item") return shipWrongItem(userId);
  return { ok: false, detail: `unknown harness action ${action}` };
}

/** Read the gateway's records, decide pass/fail, then refund whatever was paid. */
export async function finish(scenarioName: string, userId: string, trace: ToolCall[], finalTexts: string[], harnessFailures: string[]) {
  const purchases = await purchasesFor(userId);
  const verdict = evaluate(scenarioName, purchases, trace, finalTexts, harnessFailures);
  const cleaned = await cleanup(userId);
  if (cleaned.errors.length) verdict.notes.push(...cleaned.errors.map((e) => `cleanup refund failed: ${e}`));
  return { ...verdict, purchases, cleanup: cleaned };
}
