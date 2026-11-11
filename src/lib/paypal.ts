import { randomBytes } from "node:crypto";
import { gatewayCreds, paypalBase, paypalSimulated, type PayPalCreds } from "./config";

export class PayPalError extends Error {
  constructor(public status: number, public body: unknown, public debugId: string | null) {
    const b = body as { name?: string; message?: string; details?: { issue?: string; description?: string }[] } | null;
    super(`PayPal ${status}: ${b?.name ?? "error"} ${b?.details?.map((d) => d.issue).join(",") ?? b?.message ?? ""}`.trim());
  }
  get issue() { return (this.body as { details?: { issue?: string }[] } | null)?.details?.[0]?.issue ?? null; }
}

const tokens = new Map<string, { token: string; exp: number }>();
async function accessToken(c: PayPalCreds) {
  const hit = tokens.get(c.clientId);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new PayPalError(res.status, j, res.headers.get("paypal-debug-id"));
  tokens.set(c.clientId, { token: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token as string;
}

async function call<T = Record<string, unknown>>(c: PayPalCreds, method: string, path: string, body?: unknown, opts: { requestId?: string; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken(c)}`, Prefer: "return=representation" };
  if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
  if (!opts.form && body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${paypalBase()}${path}`, { method, headers, body: opts.form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  const j = text ? safeJson(text) : null;
  if (!res.ok) throw new PayPalError(res.status, j ?? text, res.headers.get("paypal-debug-id"));
  return j as T;
}
/**
 * PayPal answers 409 PREVIOUS_REQUEST_IN_PROGRESS when another call on the same payment has not finished, for
 * example a refund sent moments after tracking was added to the order. It asks the caller to wait and try again.
 */
async function whenFree<T>(f: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await f(); }
    catch (e) {
      if (!(e instanceof PayPalError) || e.status !== 409 || e.issue !== "PREVIOUS_REQUEST_IN_PROGRESS" || attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
}
const safeJson = (t: string) => { try { return JSON.parse(t); } catch { return null; } };
const need = (c: PayPalCreds | null) => { if (!c) throw new Error("PayPal credentials are not configured"); return c; };
const sim = (p: string) => `SIM-${p}-${randomBytes(5).toString("hex").toUpperCase()}`;
const usd = (cents: number) => (cents / 100).toFixed(2);
type Link = { rel: string; href: string };

// ---- Vault: the user saves their PayPal wallet once ----------------------------------------

export async function createSetupToken(returnUrl: string, cancelUrl: string) {
  if (paypalSimulated()) { const id = sim("SETUP"); return { id, approveUrl: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}approval_token_id=${id}` }; }
  const r = await call<{ id: string; links: Link[] }>(need(gatewayCreds()), "POST", "/v3/vault/setup-tokens", {
    payment_source: { paypal: {
      description: "Let your AI agents pay within the mandates you set",
      usage_type: "MERCHANT", usage_pattern: "IMMEDIATE", customer_type: "CONSUMER", permit_multiple_payment_tokens: false,
      experience_context: { brand_name: "Mandate", shipping_preference: "NO_SHIPPING", payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED", return_url: returnUrl, cancel_url: cancelUrl },
    } },
  }, { requestId: sim("REQ") });
  const approveUrl = r.links.find((l) => l.rel === "approve")?.href;
  if (!approveUrl) throw new Error("PayPal returned no approval link for the setup token");
  return { id: r.id, approveUrl };
}

export async function createPaymentToken(setupTokenId: string) {
  if (paypalSimulated()) return { vaultId: sim("VAULT"), customerId: sim("CUST"), payerId: null as string | null, payerEmail: "simulated-buyer@example.com" };
  const r = await call<{ id: string; customer?: { id: string }; payment_source?: { paypal?: { email_address?: string; payer_id?: string; account_id?: string } } }>(
    need(gatewayCreds()), "POST", "/v3/vault/payment-tokens", { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } }, { requestId: `pt-${setupTokenId}` });
  const pp = r.payment_source?.paypal;
  return { vaultId: r.id, customerId: r.customer?.id ?? null, payerId: pp?.payer_id ?? pp?.account_id ?? null, payerEmail: pp?.email_address ?? null };
}

// ---- Orders: pay a merchant from the vaulted wallet, with nobody present --------------------

export type PayResult = { orderId: string; status: string; captureId: string | null; captureStatus: string | null; raw: unknown };

type OrderInput = {
  vaultId: string; amountCents: number; currency: string; description: string; referenceId: string;
  payee: { merchantId: string | null; email: string | null } | null; sku?: string | null; itemName: string; quantity: number; unitCents: number;
};
type OrderReply = { id: string; status: string; purchase_units?: { payments?: { captures?: { id: string; status: string }[]; authorizations?: { id: string; status: string; expiration_time?: string }[] } }[] };
const orderBody = (a: OrderInput, intent: "CAPTURE" | "AUTHORIZE") => {
  const payee = a.payee?.merchantId ? { merchant_id: a.payee.merchantId } : a.payee?.email ? { email_address: a.payee.email } : undefined;
  return {
    intent,
    purchase_units: [{
      reference_id: a.referenceId, custom_id: a.referenceId, description: a.description.slice(0, 127),
      amount: { currency_code: a.currency, value: usd(a.amountCents), breakdown: { item_total: { currency_code: a.currency, value: usd(a.amountCents) } } },
      items: [{ name: a.itemName.slice(0, 127), quantity: String(a.quantity), sku: a.sku ?? undefined, unit_amount: { currency_code: a.currency, value: usd(a.unitCents) } }],
      ...(payee ? { payee } : {}),
    }],
    payment_source: { paypal: { vault_id: a.vaultId } },
  };
};

export async function payWithVault(a: OrderInput): Promise<PayResult> {
  if (paypalSimulated()) return { orderId: sim("ORDER"), status: "COMPLETED", captureId: sim("CAPTURE"), captureStatus: "COMPLETED", raw: { simulated: true } };
  const r = await call<OrderReply>(need(gatewayCreds()), "POST", "/v2/checkout/orders", orderBody(a, "CAPTURE"), { requestId: a.referenceId });
  const cap = r.purchase_units?.[0]?.payments?.captures?.[0];
  return { orderId: r.id, status: r.status, captureId: cap?.id ?? null, captureStatus: cap?.status ?? null, raw: r };
}

/**
 * Can this PayPal account be paid at all? Opens an order for the payee that nobody pays (PayPal drops unpaid orders
 * by itself). Returns a sentence when PayPal says the account does not exist, null when it is fine or cannot be told.
 */
export async function payeeProblem(payee: { merchantId: string | null; email: string | null }): Promise<string | null> {
  // Addresses under these endings can never be real accounts; PayPal only finds that out when a payment is tried.
  if (!payee.merchantId && /\.(example|invalid|test|localhost)$/i.test(payee.email ?? "")) return `${payee.email} is an example address, not a PayPal account, so this store could not be paid.`;
  if (paypalSimulated()) return null;
  const to = payee.merchantId ? { merchant_id: payee.merchantId } : { email_address: payee.email };
  try { await call(need(gatewayCreds()), "POST", "/v2/checkout/orders", { intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value: "1.00" }, payee: to }] }); return null; }
  catch (e) {
    if (e instanceof PayPalError && (e.issue === "PAYEE_ACCOUNT_INVALID" || e.issue === "INVALID_PARAMETER_SYNTAX" || e.issue === "PAYEE_ACCOUNT_RESTRICTED"))
      return `PayPal does not know a business account at ${payee.merchantId ?? payee.email}, so this store could not be paid.`;
    console.error("payee check could not be made:", e);
    return null;
  }
}

// ---- Hold now, charge on shipment: an authorization reserves the money without taking it ----

export type HoldResult = { orderId: string; status: string; authorizationId: string | null; authorizationStatus: string | null; expiresAt: string | null; raw: unknown };
/** Reserve the amount on the buyer's saved wallet for this merchant. Nothing is charged until it is captured. */
export async function holdWithVault(a: OrderInput): Promise<HoldResult> {
  if (paypalSimulated()) return { orderId: sim("ORDER"), status: "COMPLETED", authorizationId: sim("AUTH"), authorizationStatus: "CREATED", expiresAt: null, raw: { simulated: true } };
  const r = await call<OrderReply>(need(gatewayCreds()), "POST", "/v2/checkout/orders", orderBody(a, "AUTHORIZE"), { requestId: `hold-${a.referenceId}` });
  const au = r.purchase_units?.[0]?.payments?.authorizations?.[0];
  return { orderId: r.id, status: r.status, authorizationId: au?.id ?? null, authorizationStatus: au?.status ?? null, expiresAt: au?.expiration_time ?? null, raw: r };
}
/** Take the reserved money. Called when the merchant has shipped. */
export async function captureHold(authorizationId: string, requestId: string) {
  if (paypalSimulated() || authorizationId.startsWith("SIM-")) return { id: sim("CAPTURE"), status: "COMPLETED" };
  return whenFree(() => call<{ id: string; status: string }>(need(gatewayCreds()), "POST", `/v2/payments/authorizations/${authorizationId}/capture`, { final_capture: true }, { requestId }));
}
/** Release the reserved money without charging it. */
export async function voidHold(authorizationId: string, c: PayPalCreds | null = gatewayCreds()) {
  if (paypalSimulated() || authorizationId.startsWith("SIM-")) return;
  await whenFree(() => call(need(c), "POST", `/v2/payments/authorizations/${authorizationId}/void`, undefined, {}));
}

/** Attach a carrier and tracking number to the PayPal order, so the buyer sees the shipment in PayPal. */
export async function addTracking(c: PayPalCreds | null, orderId: string, a: { captureId: string; trackingNumber: string; carrier?: string }) {
  if (paypalSimulated() || orderId.startsWith("SIM-")) return { simulated: true };
  return call(need(c), "POST", `/v2/checkout/orders/${orderId}/track`, { capture_id: a.captureId, tracking_number: a.trackingNumber, carrier: a.carrier ?? "OTHER", carrier_name_other: a.carrier ? undefined : "Store courier", notify_payer: false });
}
export const getCapture = (captureId: string, c = gatewayCreds()) => call<{ id: string; status: string; amount?: { value: string; currency_code: string }; payee?: { merchant_id?: string; email_address?: string }; custom_id?: string }>(need(c), "GET", `/v2/payments/captures/${captureId}`);

export const getOrder = (orderId: string, c = gatewayCreds()) => call(need(c), "GET", `/v2/checkout/orders/${orderId}`);

// ---- Refunds: issued by whoever received the money ------------------------------------------

export async function refundCapture(c: PayPalCreds | null, captureId: string, a: { amountCents?: number; currency?: string; note: string; requestId: string }) {
  if (paypalSimulated() || captureId.startsWith("SIM-")) return { id: sim("REFUND"), status: "COMPLETED" };
  return whenFree(() => call<{ id: string; status: string }>(need(c), "POST", `/v2/payments/captures/${captureId}/refund`, {
    ...(a.amountCents ? { amount: { value: usd(a.amountCents), currency_code: a.currency ?? "USD" } } : {}),
    note_to_payer: a.note.slice(0, 255),
  }, { requestId: a.requestId }));
}

// ---- Disputes: merchant-side only. A buyer cannot open one through the API. -----------------

export type Dispute = { dispute_id: string; reason: string; status: string; dispute_state?: string; dispute_life_cycle_stage?: string;
  dispute_amount?: { value: string; currency_code: string }; disputed_transactions?: { seller_transaction_id?: string; buyer_transaction_id?: string; custom?: string }[]; links?: Link[];
  dispute_outcome?: { outcome_code?: string } };

export const listDisputes = (c: PayPalCreds, q: { transactionId?: string } = {}) =>
  call<{ items?: Dispute[] }>(c, "GET", `/v1/customer/disputes${q.transactionId ? `?disputed_transaction_id=${encodeURIComponent(q.transactionId)}` : "?page_size=20"}`);
export const getDispute = (c: PayPalCreds, id: string) => call<Dispute>(c, "GET", `/v1/customer/disputes/${id}`);
/** Sandbox only: stands in for the PayPal agent who rules on a dispute that is under review. */
export const adjudicate = (c: PayPalCreds, id: string, outcome: "SELLER_FAVOR" | "BUYER_FAVOR") =>
  call(c, "POST", `/v1/customer/disputes/${id}/adjudicate`, { adjudication_outcome: outcome });
export const acceptClaim = (c: PayPalCreds, id: string, note: string) =>
  call(c, "POST", `/v1/customer/disputes/${id}/accept-claim`, { note: note.slice(0, 2000) });
export const sendDisputeMessage = (c: PayPalCreds, id: string, message: string) =>
  call(c, "POST", `/v1/customer/disputes/${id}/send-message`, { message: message.slice(0, 2000) });
/** Attach the signed evidence record to a dispute. PayPal takes the JSON `input` part plus the file itself. */
export function provideEvidence(c: PayPalCreds, id: string, a: { notes: string; evidenceType: string; evidenceInfo?: Record<string, unknown>; filename: string; file: Buffer }) {
  const form = new FormData();
  form.append("input", new Blob([JSON.stringify({ evidences: [{ evidence_type: a.evidenceType, ...(a.evidenceInfo ? { evidence_info: a.evidenceInfo } : {}), notes: a.notes.slice(0, 2000) }] })], { type: "application/json" }));
  form.append("file1", new Blob([new Uint8Array(a.file)], { type: "application/pdf" }), a.filename);
  return call(c, "POST", `/v1/customer/disputes/${id}/provide-evidence`, undefined, { form });
}

// ---- Webhooks -------------------------------------------------------------------------------

export async function verifyWebhook(headers: Headers, rawBody: string, webhookId: string | undefined, c = gatewayCreds()) {
  if (!c || !webhookId) return false;
  const h = (n: string) => headers.get(n) ?? "";
  try {
    const r = await call<{ verification_status: string }>(c, "POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: h("paypal-auth-algo"), cert_url: h("paypal-cert-url"), transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"), transmission_time: h("paypal-transmission-time"),
      webhook_id: webhookId, webhook_event: JSON.parse(rawBody),
    });
    return r.verification_status === "SUCCESS";
  } catch { return false; }
}
