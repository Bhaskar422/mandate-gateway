import { z } from "zod";

/** Categories that are never allowed unless the user names them: they are how stolen spend is cashed out. */
export const ALWAYS_BLOCKED = ["gift cards", "prepaid cards", "cryptocurrency", "money transfers"] as const;

export const MandateRulesSchema = z.object({
  summary: z.string().describe("One sentence restating the mandate in plain English"),
  currency: z.string().length(3).describe("ISO 4217 code, e.g. USD"),
  totalLimitCents: z.number().int().positive().describe("Most the agent may spend in total under this mandate, in cents"),
  perPurchaseLimitCents: z.number().int().positive().nullable().describe("Most for a single purchase, in cents; null if the user gave none"),
  dailyLimitCents: z.number().int().positive().nullable().describe("Most the agent may spend in one calendar day (UTC), in cents; null if the user gave none"),
  perMerchantLimitCents: z.number().int().positive().nullable().describe("Most the agent may spend at any single merchant, in cents; null if the user gave none"),
  approvalThresholdCents: z.number().int().nonnegative().nullable().describe("Purchases above this amount need the user's approval; null if the user gave none"),
  allowedCategories: z.array(z.string()).min(1).describe("What the agent may buy, as short product categories, e.g. 'running shoes'"),
  merchantPolicy: z.enum(["verified_only", "allowlist", "any_registered"]).describe("verified_only: merchants the gateway has verified ('known merchants'). allowlist: only the named merchants. any_registered: any merchant the gateway can pay."),
  allowedMerchants: z.array(z.string()).describe("Merchant names or domains, only when merchantPolicy is allowlist; otherwise empty"),
  blockedMerchants: z.array(z.string()).describe("Merchants the user said never to buy from; empty if none"),
  maxPurchases: z.number().int().positive().nullable().describe("Maximum number of purchases; null if the user gave none"),
  expiresAt: z.string().describe("ISO 8601 timestamp when the mandate ends. If the user gave none, 7 days from now."),
});
export type MandateRules = z.infer<typeof MandateRulesSchema>;

/** Rules written before a limit existed: the missing fields mean "no such limit". */
export type MandateRulesInput = Partial<MandateRules> & Pick<MandateRules, "summary" | "currency" | "totalLimitCents" | "allowedCategories" | "merchantPolicy" | "expiresAt">;
export function normalizeRules(r: MandateRulesInput): MandateRules {
  return {
    perPurchaseLimitCents: null, dailyLimitCents: null, perMerchantLimitCents: null, approvalThresholdCents: null,
    allowedMerchants: [], blockedMerchants: [], maxPurchases: null, ...r,
  };
}
