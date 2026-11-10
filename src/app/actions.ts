"use server";
import { revalidatePath } from "next/cache";
import { confirmMandate, createAgent, decideApproval, reportProblem, resolveMerchantNames, revokeMandate } from "@/lib/gateway";
import { compileMandate } from "@/lib/llm";
import { MandateRulesSchema, type MandateRules } from "@/lib/rules";
import { currentUserId } from "@/lib/session";
import { sandboxRuling, shipOrder, syncDisputes } from "@/lib/stores/merchant";

type R<T> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });

export async function compileMandateAction(text: string): Promise<R<{ rules: MandateRules; warnings: string[] }>> {
  try {
    await currentUserId();
    if (text.trim().length < 8) throw new Error("Describe what the agent may buy and how much it may spend.");
    const rules = await compileMandate(text.slice(0, 2000));
    const warnings: string[] = [];
    if (rules.merchantPolicy === "allowlist") {
      const r = await resolveMerchantNames(rules.allowedMerchants);
      rules.allowedMerchants = r.resolved;
      for (const u of r.unknown) warnings.push(`"${u}" is not a merchant this gateway knows, so purchases there will be blocked.`);
    }
    return { ok: true, rules, warnings };
  } catch (e) { return fail(e); }
}
export async function confirmMandateAction(text: string, rules: MandateRules): Promise<R<object>> {
  try {
    const parsed = MandateRulesSchema.parse(rules);
    if (!(new Date(parsed.expiresAt) > new Date())) throw new Error("The expiry must be in the future.");
    await confirmMandate(await currentUserId(), text.slice(0, 2000), parsed); revalidatePath("/"); return { ok: true };
  } catch (e) { return fail(e); }
}
export async function revokeMandateAction() { await revokeMandate(await currentUserId()); revalidatePath("/"); }
export async function createAgentAction(name: string): Promise<R<{ key: string }>> {
  try { const { key } = await createAgent(await currentUserId(), name); revalidatePath("/"); return { ok: true, key }; } catch (e) { return fail(e); }
}
export async function approvalAction(purchaseId: string, approve: boolean): Promise<R<object>> {
  try { await decideApproval(await currentUserId(), purchaseId, approve); revalidatePath("/"); return { ok: true }; } catch (e) { return fail(e); }
}
export async function reportProblemAction(purchaseId: string, report: string): Promise<R<{ message: string }>> {
  try { const r = await reportProblem(await currentUserId(), purchaseId, report); revalidatePath("/"); return { ok: true, message: r.message }; } catch (e) { return fail(e); }
}
// Store back office (the merchant's side of the demo).
export async function shipOrderAction(slug: string, orderId: string, sku: string) { await shipOrder(slug, orderId, sku); revalidatePath(`/stores/${slug}/admin`); }
export async function syncDisputesAction(slug: string) { const r = await syncDisputes(slug); revalidatePath(`/stores/${slug}/admin`); return r; }
export async function sandboxRulingAction(slug: string, orderId: string) { await sandboxRuling(slug, orderId); revalidatePath(`/stores/${slug}/admin`); }
