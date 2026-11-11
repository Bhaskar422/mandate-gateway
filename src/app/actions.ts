"use server";
// Every mutation the web app can make. Each one resolves the signed-in user itself; none trusts a user id from the client.
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { restartAssistant } from "@/lib/assistant";
import type { UserSettings } from "@/lib/db/schema";
import { answerOffer, cancelHold, confirmMandate, createAgent, decideApproval, decideByToken, pauseAgent, reportProblem, resolveMerchantNames, resumeAgent, revokeAgent, revokeMandate, rotateAgentKey, setFrozen, updateSettings } from "@/lib/gateway";
import { publicKeyPem, verifyBundle, type LedgerRow } from "@/lib/ledger";
import { clearDemoWallet, DEMO_MANDATE_CAP_CENTS, isDemoUser, setDemoWalletFromUser, useDemoWallet as takeDemoWallet } from "@/lib/demo-wallet";
import { draftMandate } from "@/lib/llm";
import { reviewDraft, type MandateQuestion } from "@/lib/mandate-check";
import { mandateExamples, type MandateExample } from "@/lib/mandate-examples";
import { ownershipToken, registerMerchant, removeMerchant, setMerchantVerified, verifyMerchantDomain } from "@/lib/merchants";
import { reconcilePurchase, type ReconcileRow } from "@/lib/reconcile";
import { operatorSignIn, operatorSignOut, requireOperator } from "@/lib/operator";
import { MandateRulesSchema, type MandateRules } from "@/lib/rules";
import { currentUserId, newSessionId, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { appUrl } from "@/lib/config";
import { publishVerificationToken, sandboxRuling, shipOrder, syncDisputes } from "@/lib/stores/merchant";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });
const done = () => { revalidatePath("/", "layout"); return { ok: true as const }; };

/** The demo wallet is shared, so a mandate that spends from it is held to a smaller budget. Returns what it changed. */
function capForDemo(rules: MandateRules): string[] {
  if (rules.totalLimitCents <= DEMO_MANDATE_CAP_CENTS) return [];
  const was = rules.totalLimitCents;
  rules.totalLimitCents = DEMO_MANDATE_CAP_CENTS;
  for (const k of ["perPurchaseLimitCents", "dailyLimitCents", "perMerchantLimitCents"] as const) if (rules[k] != null && rules[k]! > DEMO_MANDATE_CAP_CENTS) rules[k] = DEMO_MANDATE_CAP_CENTS;
  if (rules.approvalThresholdCents != null && rules.approvalThresholdCents >= DEMO_MANDATE_CAP_CENTS) rules.approvalThresholdCents = null;
  return [`You are using the shared demo wallet, so the budget was lowered from $${(was / 100).toFixed(0)} to $${(DEMO_MANDATE_CAP_CENTS / 100).toFixed(0)}. Link your own PayPal sandbox account to lift this.`];
}

// ---- Mandates ---------------------------------------------------------------------------------

export async function compileMandateAction(text: string): Promise<R<{ rules: MandateRules; warnings: string[]; questions: MandateQuestion[]; examples: MandateExample[] }>> {
  try {
    const userId = await currentUserId();
    if (text.trim().length < 8) throw new Error("Describe what the agent may buy and how much it may spend.");
    const draft = await draftMandate(text.slice(0, 2000));
    // The model's draft is checked against the user's own words in code before the user ever sees it.
    const review = reviewDraft(text, draft.rules);
    const rules = review.rules, warnings = [...review.changes];
    if (await isDemoUser(userId)) for (const w of capForDemo(rules)) warnings.push(w);
    if (rules.merchantPolicy === "allowlist") {
      const r = await resolveMerchantNames(rules.allowedMerchants);
      rules.allowedMerchants = r.resolved;
      for (const u of r.unknown) warnings.push(`"${u}" is not a merchant this gateway knows, so purchases there will be blocked.`);
    }
    if (rules.blockedMerchants.length) rules.blockedMerchants = (await resolveMerchantNames(rules.blockedMerchants)).resolved;
    const asked = new Set(review.questions.map((q) => q.id));
    // The model's own questions are advisory: the user may answer them or keep the narrower reading it chose.
    const fromModel = draft.questions.filter((q) => !(asked.has("amount") && /how much|budget|spend/i.test(q.question)) && !(asked.has("currency") && /currenc/i.test(q.question)) && !(asked.has("category") && /what .*buy|categor|product/i.test(q.question)))
      .map((q, i) => ({ id: `model-${i}`, question: q.question.slice(0, 300), hint: q.hint.slice(0, 200), required: false }));
    return { ok: true, rules, warnings, questions: [...review.questions, ...fromModel], examples: mandateExamples(rules) };
  } catch (e) { return fail(e); }
}
export async function confirmMandateAction(text: string, rules: MandateRules, opts: { name?: string; agentIds?: string[] | null; replaceId?: string } = {}): Promise<R> {
  try {
    const parsed = MandateRulesSchema.parse(rules);
    if (!(new Date(parsed.expiresAt) > new Date())) throw new Error("The expiry must be in the future.");
    // Checked again here, so rules sent by a modified page cannot skip the review.
    const review = reviewDraft(text, parsed);
    const open = review.questions.filter((q) => q.required);
    if (open.length) throw new Error(`Answer this first: ${open[0].question}`);
    const userId = await currentUserId();
    if (await isDemoUser(userId)) capForDemo(review.rules);
    await confirmMandate(userId, text.slice(0, 2000), review.rules, opts);
    return done();
  } catch (e) { return fail(e); }
}
/** Revoke one mandate, or all of them when no id is given. */
export async function revokeMandateAction(mandateId?: string): Promise<R> {
  try { await revokeMandate(await currentUserId(), mandateId); return done(); } catch (e) { return fail(e); }
}

// ---- Agents and account -----------------------------------------------------------------------

export async function createAgentAction(name: string): Promise<R<{ key: string }>> {
  try { const { key } = await createAgent(await currentUserId(), name); revalidatePath("/", "layout"); return { ok: true, key }; } catch (e) { return fail(e); }
}
export async function pauseAgentAction(agentId: string): Promise<R> { try { await pauseAgent(await currentUserId(), agentId); return done(); } catch (e) { return fail(e); } }
export async function resumeAgentAction(agentId: string): Promise<R> { try { await resumeAgent(await currentUserId(), agentId); return done(); } catch (e) { return fail(e); } }
export async function revokeAgentAction(agentId: string): Promise<R> { try { await revokeAgent(await currentUserId(), agentId); return done(); } catch (e) { return fail(e); } }
/** Replace an agent's key. The old key stops working at once; the new one is shown once. */
export async function rotateAgentKeyAction(agentId: string): Promise<R<{ key: string }>> {
  try { const key = await rotateAgentKey(await currentUserId(), agentId); revalidatePath("/", "layout"); return { ok: true, key }; } catch (e) { return fail(e); }
}
/** Use the gateway's shared demo wallet instead of linking a PayPal account. */
export async function useDemoWalletAction(): Promise<R> { try { await takeDemoWallet(await currentUserId()); return done(); } catch (e) { return fail(e); } }
/** The kill switch. */
export async function setFrozenAction(frozen: boolean): Promise<R> { try { await setFrozen(await currentUserId(), frozen); return done(); } catch (e) { return fail(e); } }
export async function updateSettingsAction(patch: UserSettings): Promise<R> { try { await updateSettings(await currentUserId(), patch); return done(); } catch (e) { return fail(e); } }

/**
 * Forget this browser's session. The account itself stays, and linking the same PayPal account brings it back.
 * The browser is handed a new anonymous session in the same response, so it never renders a page with no session.
 */
export async function signOutAction(): Promise<never> {
  (await cookies()).set(SESSION_COOKIE, newSessionId(), sessionCookieOptions(appUrl().startsWith("https:")));
  redirect("/");
}
/** Start a new built-in shopping assistant after the last one was revoked. */
export async function restartAssistantAction(): Promise<R> { try { await restartAssistant(await currentUserId()); return done(); } catch (e) { return fail(e); } }

// ---- Purchases --------------------------------------------------------------------------------

export async function approvalAction(purchaseId: string, approve: boolean): Promise<R> {
  try { await decideApproval(await currentUserId(), purchaseId, approve); return done(); } catch (e) { return fail(e); }
}
/** Cancel a reserved purchase before the store ships it. Nothing is charged. */
export async function cancelHoldAction(purchaseId: string): Promise<R> {
  try { await cancelHold(await currentUserId(), purchaseId); return done(); } catch (e) { return fail(e); }
}
/** Compare the gateway's record of a purchase with PayPal's own record of the order. Changes nothing. */
export async function reconcilePurchaseAction(purchaseId: string): Promise<R<{ rows: ReconcileRow[]; allMatch: boolean; checkedAt: string; note?: string }>> {
  try { const r = await reconcilePurchase(await currentUserId(), purchaseId); return { ok: true, rows: r.rows, allMatch: r.ok, checkedAt: r.checkedAt, note: r.note }; } catch (e) { return fail(e); }
}
/** Approve or decline from the secret link, without a dashboard session. */
export async function approveByTokenAction(token: string, approve: boolean): Promise<R<{ status: string }>> {
  try { const p = await decideByToken(token, approve); revalidatePath("/", "layout"); return { ok: true, status: p.status }; } catch (e) { return fail(e); }
}
export async function reportProblemAction(purchaseId: string, report: string): Promise<R<{ message: string; status: string }>> {
  try { const r = await reportProblem(await currentUserId(), purchaseId, report); revalidatePath("/", "layout"); return { ok: true, message: r.message, status: r.case.status }; } catch (e) { return fail(e); }
}
export async function answerOfferAction(caseId: string, accept: boolean): Promise<R<{ message: string; status: string }>> {
  try { const r = await answerOffer(await currentUserId(), caseId, accept); revalidatePath("/", "layout"); return { ok: true, message: r.message, status: r.case.status }; } catch (e) { return fail(e); }
}

// ---- Merchants --------------------------------------------------------------------------------

export async function registerMerchantAction(url: string): Promise<R<{ merchantId: string; token: string | null; claiming: boolean; wellKnownUrl: string }>> {
  try {
    const userId = await currentUserId();
    const m = await registerMerchant(userId, url);
    // A token is only ever handed to the browser it was issued to.
    const own = await ownershipToken(userId, m);
    revalidatePath("/", "layout");
    return { ok: true, merchantId: m.id, token: own.token, claiming: own.claiming, wellKnownUrl: `${m.baseUrl}/.well-known/mandate-merchant.json` };
  } catch (e) { return fail(e); }
}
export async function verifyMerchantAction(merchantId: string): Promise<R<{ name: string }>> {
  try { const m = await verifyMerchantDomain(await currentUserId(), merchantId); revalidatePath("/", "layout"); return { ok: true, name: m.name }; } catch (e) { return fail(e); }
}

// ---- Operator (the people who run this gateway) -----------------------------------------------

export async function operatorSignInAction(key: string): Promise<R> { try { await operatorSignIn(key); return done(); } catch (e) { return fail(e); } }
export async function operatorSignOutAction(): Promise<R> { try { await operatorSignOut(); return done(); } catch (e) { return fail(e); } }
/** Grant or withdraw a store's verified status. */
export async function reviewMerchantAction(merchantId: string, verified: boolean): Promise<R> {
  try { await requireOperator(); await setMerchantVerified(merchantId, verified); return done(); } catch (e) { return fail(e); }
}
export async function removeMerchantAction(merchantId: string): Promise<R> {
  try { await requireOperator(); await removeMerchant(merchantId); return done(); } catch (e) { return fail(e); }
}

/** Lend out, as the demo wallet, the PayPal wallet linked in the operator's own browser. */
export async function setDemoWalletAction(): Promise<R> { try { await requireOperator(); await setDemoWalletFromUser(await currentUserId()); return done(); } catch (e) { return fail(e instanceof Error && e.message === "No session" ? new Error("Open the dashboard in this browser and link a sandbox buyer first.") : e); } }
export async function clearDemoWalletAction(): Promise<R> { try { await requireOperator(); await clearDemoWallet(); return done(); } catch (e) { return fail(e); } }

// ---- Evidence ---------------------------------------------------------------------------------

/** Check an evidence record anyone hands you: every entry must be signed by this gateway and hash correctly. */
export async function verifyEvidenceAction(json: string): Promise<R<{ purchaseId: string | null; entries: { seq: number; type: string; at: string }[] }>> {
  try {
    const b = JSON.parse(json) as { purchaseId?: string; publicKey?: string; entries?: LedgerRow[] };
    if (!Array.isArray(b.entries) || !b.entries.length || typeof b.publicKey !== "string") throw new Error("This is not an evidence record: it needs a publicKey and entries.");
    const v = verifyBundle({ publicKey: b.publicKey, entries: b.entries }, publicKeyPem());
    if (!v.ok) throw new Error(`Verification failed: ${v.why}.`);
    return { ok: true, purchaseId: b.purchaseId ?? null, entries: b.entries.map((e) => ({ seq: e.seq, type: e.type, at: e.at })) };
  } catch (e) { return fail(e instanceof SyntaxError ? new Error("That is not valid JSON.") : e); }
}

// ---- Store back office (the merchant's side of the demo) --------------------------------------

export async function shipOrderAction(slug: string, orderId: string, sku: string) { await shipOrder(slug, orderId, sku); revalidatePath(`/stores/${slug}/admin`); }
export async function syncDisputesAction(slug: string) { const r = await syncDisputes(slug); revalidatePath(`/stores/${slug}/admin`); return r; }
export async function sandboxRulingAction(slug: string, orderId: string) { const r = await sandboxRuling(slug, orderId); revalidatePath(`/stores/${slug}/admin`); return r; }
export async function publishTokenAction(slug: string, token: string) { await publishVerificationToken(slug, token); revalidatePath(`/stores/${slug}/admin`); }
