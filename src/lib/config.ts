/** Public base URL. On Vercel it defaults to the project's production domain. */
export const appUrl = () =>
  (process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")).replace(/\/$/, "");
export const llmModel = () => process.env.LLM_MODEL ?? "claude-opus-5-5";
export const llmConfigured = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export type PayPalCreds = { clientId: string; secret: string };
export const paypalBase = () => (process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
export const gatewayCreds = (): PayPalCreds | null =>
  process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET
    ? { clientId: process.env.PAYPAL_CLIENT_ID, secret: process.env.PAYPAL_CLIENT_SECRET } : null;
/** Demo simplification: a store without its own sandbox business account borrows another store's. */
const SHARED_ACCOUNT: Record<string, string> = { peak: "stride" };
/** Each demo store is its own PayPal business with its own REST app, e.g. PAYPAL_STORE_STRIDE_CLIENT_ID. */
export function storeCreds(slug: string): PayPalCreds | null {
  const k = `PAYPAL_STORE_${slug.toUpperCase()}`;
  const clientId = process.env[`${k}_CLIENT_ID`], secret = process.env[`${k}_CLIENT_SECRET`];
  if (clientId && secret) return { clientId, secret };
  return SHARED_ACCOUNT[slug] ? storeCreds(SHARED_ACCOUNT[slug]) : null;
}
export const storePayee = (slug: string): { merchantId: string | null; email: string | null } => {
  const k = `PAYPAL_STORE_${slug.toUpperCase()}`;
  const own = { merchantId: process.env[`${k}_MERCHANT_ID`] ?? null, email: process.env[`${k}_EMAIL`] ?? null };
  return own.merchantId || own.email || !SHARED_ACCOUNT[slug] ? own : storePayee(SHARED_ACCOUNT[slug]);
};
/** With no PayPal credentials the gateway simulates PayPal so the flows can be exercised. Clearly labelled in the UI. */
export const paypalSimulated = () => !gatewayCreds();
