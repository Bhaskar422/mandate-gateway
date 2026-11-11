// A second opinion on the rules a model drafted from the user's words, in plain code. It can only make the draft
// narrower or ask the user a question; it never widens anything. It runs when the draft is made and again when
// the user confirms, so a tampered or stale draft cannot skip it.
import type { MandateRules } from "./rules";

export type MandateQuestion = {
  id: string;
  question: string;
  /** What an answer looks like. */
  hint: string;
  /** A required question blocks confirmation until the mandate text answers it. */
  required: boolean;
};
export type DraftReview = { rules: MandateRules; changes: string[]; questions: MandateQuestion[] };

/** The most any one mandate may authorise, whatever the text says. */
export const MAX_TOTAL_CENTS = Number(process.env.MANDATE_MAX_TOTAL_CENTS ?? 500_000);
export const MAX_DAYS = 90;

const CURRENCIES: [RegExp, string][] = [
  [/\$|\busd\b|\bdollars?\b|\bbucks?\b/i, "USD"], [/€|\beur\b|\beuros?\b/i, "EUR"], [/£|\bgbp\b|\bpounds?\b/i, "GBP"],
  [/₹|\binr\b|\brupees?\b/i, "INR"], [/¥|\bjpy\b|\byen\b/i, "JPY"], [/\bcad\b/i, "CAD"], [/\baud\b/i, "AUD"],
];
const money = (cents: number, cur: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(cents / 100);

/** Every money amount written with digits in the text, in cents. "$1,200", "150 dollars", "80 usd", "€40", "2k". */
export function amountsIn(text: string): number[] {
  const out: number[] = [];
  const num = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s*(k)?`;
  const sym = new RegExp(String.raw`[$€£₹¥]\s*${num}`, "gi");
  const word = new RegExp(String.raw`${num}\s*(?:usd|eur|gbp|inr|jpy|cad|aud|dollars?|euros?|pounds?|rupees?|yen|bucks?)\b`, "gi");
  for (const re of [sym, word]) for (const m of text.matchAll(re)) {
    const v = Number(`${m[1].replace(/,/g, "")}${m[2] ?? ""}`) * (m[3] ? 1000 : 1);
    if (Number.isFinite(v) && v >= 0) out.push(Math.round(v * 100));
  }
  return out;
}

const ANY_STORE = /\b(?:any|all|every|whatever|whichever)\s+(?:registered\s+|online\s+)?(?:store|shop|merchant|seller|retailer|site|website|vendor)s?\b|\banywhere\b|\bany\s*where\b|\bfrom\s+anyone\b/i;
const CASH = /gift\s*cards?|prepaid|voucher|crypto|bitcoin|money\s+(?:transfer|order)|wire\s+transfer|store\s+credit/i;
const ASK = /\b(?:ask|check with|confirm with|run it by|get my (?:ok|okay|approval))\b[^.]{0,20}\bme\b|\bmy approval\b|\bask first\b/i;
const NEVER_ASK = /\b(?:never|don'?t|do not|no need to|without)\s+(?:ask|asking|bother|bothering|check|checking|confirm|confirming)\b/i;
const VAGUE_CATEGORY = /unspecified|please confirm|not specified|unknown|n\/a|^none\b|no spending|^tbd$/i;
const ANYTHING = /^(?:anything|everything|any(?:thing| product| item)s?|all products?|whatever)$/i;
const SAID_ANYTHING = /\b(?:anything|everything|whatever i need|any (?:product|item|thing)s?)\b/i;

/**
 * Check a drafted rule set against the user's own words.
 * `text` is everything the user has written for this mandate, including answers to earlier questions.
 */
export function reviewDraft(text: string, draft: MandateRules, now = new Date()): DraftReview {
  const r: MandateRules = { ...draft, allowedCategories: [...draft.allowedCategories], allowedMerchants: [...draft.allowedMerchants], blockedMerchants: [...(draft.blockedMerchants ?? [])] };
  const changes: string[] = [], questions: MandateQuestion[] = [];
  const cur = r.currency;
  const amounts = amountsIn(text).filter((a) => a > 0);

  // ---- Currency -------------------------------------------------------------------------------
  const mentioned = [...new Set(CURRENCIES.filter(([re]) => re.test(text)).map(([, c]) => c))];
  if (mentioned.length > 1) questions.push({ id: "currency", required: true, question: `You mentioned more than one currency (${mentioned.join(", ")}). Which one do the limits use?`, hint: "For example: “All amounts are in US dollars.”" });

  // ---- The budget -----------------------------------------------------------------------------
  // A budget written without a currency word the parser knows ("120 dólares", "80") still counts if the draft's
  // total is a number the user actually wrote.
  const bare = [...text.matchAll(/(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?(?![\w%])/g)].map((m) => Math.round(Number(`${m[1].replace(/,/g, "")}${m[2] ?? ""}`) * 100));
  if (!amounts.length && bare.includes(r.totalLimitCents)) amounts.push(r.totalLimitCents);
  if (!amounts.length) {
    questions.push({ id: "amount", required: true, question: "How much may the agent spend in total?", hint: "Write the amount in figures, for example “Up to $80 in total.”" });
  } else {
    const largest = Math.max(...amounts);
    if (r.totalLimitCents > largest) changes.push(`The draft allows ${money(r.totalLimitCents, cur)} in total, more than the largest amount you wrote (${money(largest, cur)}). Check that this is what you meant.`);
  }
  if (r.totalLimitCents < 100) questions.push({ id: "amount-small", required: true, question: "The budget came out under one dollar, so nothing could be bought. How much may the agent spend in total?", hint: "For example “Up to $40 in total.”" });
  if (r.totalLimitCents > MAX_TOTAL_CENTS) {
    changes.push(`The total budget was lowered from ${money(r.totalLimitCents, cur)} to ${money(MAX_TOTAL_CENTS, cur)}, the most a single mandate may authorise on this gateway.`);
    r.totalLimitCents = MAX_TOTAL_CENTS;
  }
  for (const [key, label] of [["perPurchaseLimitCents", "per-purchase limit"], ["dailyLimitCents", "daily limit"], ["perMerchantLimitCents", "per-store limit"]] as const) {
    const v = r[key];
    if (v != null && v > r.totalLimitCents) {
      changes.push(`The ${label} (${money(v, cur)}) was above the total budget, so it was lowered to ${money(r.totalLimitCents, cur)}.`);
      r[key] = r.totalLimitCents;
    }
  }

  // ---- Asking first ---------------------------------------------------------------------------
  if (r.approvalThresholdCents != null && r.approvalThresholdCents >= r.totalLimitCents) {
    changes.push(`An ask-first amount of ${money(r.approvalThresholdCents, cur)} could never be reached under a ${money(r.totalLimitCents, cur)} budget, so it was removed.`);
    r.approvalThresholdCents = null;
  }
  if (r.approvalThresholdCents == null && ASK.test(text) && !NEVER_ASK.test(text)) {
    changes.push("You asked to be consulted, but the draft had no ask-first amount. It is now set to ask you before every purchase.");
    r.approvalThresholdCents = 0;
  }

  // ---- Stores ---------------------------------------------------------------------------------
  if (r.merchantPolicy === "any_registered" && !ANY_STORE.test(text)) {
    changes.push("The draft allowed any store, but you did not say any store is fine. It is now limited to verified stores.");
    r.merchantPolicy = "verified_only";
  }
  if (r.merchantPolicy !== "allowlist" && r.allowedMerchants.length) r.allowedMerchants = [];
  if (r.merchantPolicy === "allowlist") {
    const unsaid = r.allowedMerchants.filter((m) => !text.toLowerCase().includes(m.toLowerCase().split(/\s+/)[0]));
    if (unsaid.length) {
      r.allowedMerchants = r.allowedMerchants.filter((m) => !unsaid.includes(m));
      changes.push(`${unsaid.join(", ")} ${unsaid.length === 1 ? "was" : "were"} removed from the allowed stores because you did not name ${unsaid.length === 1 ? "it" : "them"}.`);
    }
    if (!r.allowedMerchants.length) questions.push({ id: "stores", required: true, question: "Which stores may the agent buy from?", hint: "Name them, or say “verified stores only” or “any store”." });
  }

  // ---- What may be bought ---------------------------------------------------------------------
  const cashCats = r.allowedCategories.filter((c) => CASH.test(c));
  if (cashCats.length && !CASH.test(text)) {
    r.allowedCategories = r.allowedCategories.filter((c) => !cashCats.includes(c));
    changes.push(`${cashCats.join(", ")} ${cashCats.length === 1 ? "was" : "were"} removed: gift cards and other cash equivalents are only allowed when you ask for them by name.`);
  }
  const vague = r.allowedCategories.filter((c) => VAGUE_CATEGORY.test(c.trim()));
  r.allowedCategories = r.allowedCategories.filter((c) => !vague.includes(c));
  const broad = r.allowedCategories.filter((c) => ANYTHING.test(c.trim()));
  if (broad.length && !SAID_ANYTHING.test(text)) r.allowedCategories = r.allowedCategories.filter((c) => !broad.includes(c));
  else if (broad.length) changes.push("This mandate lets the agent buy anything within the budget. Gift cards and other cash equivalents stay blocked.");
  if (!r.allowedCategories.length) {
    questions.push({ id: "category", required: true, question: "What may the agent buy?", hint: "Name the kind of product, for example “running shoes” or “coffee beans and brewing gear”." });
    r.allowedCategories = ["(not yet said)"];
  }

  // ---- How long -------------------------------------------------------------------------------
  const exp = new Date(r.expiresAt).getTime(), latest = now.getTime() + MAX_DAYS * 864e5;
  if (!Number.isFinite(exp) || exp <= now.getTime()) {
    r.expiresAt = new Date(now.getTime() + 7 * 864e5).toISOString();
    changes.push("The end date in the draft was not in the future, so the mandate is set to last 7 days.");
  } else if (exp > latest) {
    r.expiresAt = new Date(latest).toISOString();
    changes.push(`A mandate lasts at most ${MAX_DAYS} days, so the end date was brought forward.`);
  }
  return { rules: r, changes, questions };
}

