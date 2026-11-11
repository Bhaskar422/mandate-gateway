// Merchant onboarding. Any store can register by URL; the gateway will only pay it once it has proved
// control of that URL by publishing a token the gateway issued.
import { and, desc, eq } from "drizzle-orm";
import { appUrl } from "./config";
import { db, schema } from "./db";
import { ensureSeed } from "./gateway";
import { newId } from "./ids";
import { append } from "./ledger";
import { payeeProblem } from "./paypal";

const { merchants, merchantClaims } = schema;
const newToken = () => `mandate-verify-${newId("t").slice(2)}${newId("t").slice(2)}`;
export const WELL_KNOWN = "/.well-known/mandate-merchant.json";

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;
/** Normalise a store URL and refuse ones the gateway must not fetch. */
export function normaliseStoreUrl(raw: string) {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`); } catch { throw new Error("That is not a valid URL"); }
  const own = new URL(appUrl());
  const sameAsGateway = u.host === own.host;
  if (!sameAsGateway) {
    if (u.protocol !== "https:") throw new Error("A store must be served over https");
    if (PRIVATE.test(u.hostname) || !u.hostname.includes(".")) throw new Error("That address is not reachable from the public internet");
  }
  if (u.username || u.password) throw new Error("The URL must not contain credentials");
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
}

/** Step 1: record the store and issue the token it has to publish. */
export async function registerMerchant(userId: string, rawUrl: string) {
  await ensureSeed();
  const baseUrl = normaliseStoreUrl(rawUrl);
  const [existing] = await db.select().from(merchants).where(eq(merchants.baseUrl, baseUrl));
  if (existing) return existing;
  const [m] = await db.insert(merchants).values({ id: newId("mer"), name: new URL(baseUrl).hostname, baseUrl, verified: false, source: "onboarded",
    verificationToken: newToken(), registeredBy: userId }).returning();
  await append({ userId, type: "merchant.registered", payload: { merchantId: m.id, baseUrl } });
  return m;
}

/**
 * The token this browser must publish to prove it owns the store, or null when there is nothing left to prove.
 * The registrant of an unproved store gets the store's own token. Anyone else gets a token of their own: publishing
 * it makes them the registrant, which is how a seller reaches their store from a new browser. A token is never
 * shown to a browser it was not issued to.
 */
export async function ownershipToken(userId: string, m: typeof merchants.$inferSelect): Promise<{ token: string | null; claiming: boolean }> {
  if (m.source !== "onboarded") return { token: null, claiming: false };
  if (m.registeredBy === userId) return { token: m.domainVerifiedAt ? null : m.verificationToken, claiming: false };
  const [mine] = await db.select().from(merchantClaims).where(and(eq(merchantClaims.merchantId, m.id), eq(merchantClaims.userId, userId)));
  if (mine) return { token: mine.token, claiming: true };
  const [made] = await db.insert(merchantClaims).values({ merchantId: m.id, userId, token: newToken() }).onConflictDoNothing().returning();
  return { token: made?.token ?? null, claiming: true };
}

type WellKnown = { mandate_verification?: string; name?: string; paypal?: { merchant_id?: string; email?: string }; orders_url?: string; returns_url?: string; catalog_url?: string; holds?: boolean };

/** Step 2: fetch the store's well-known file and check the token. Only then does it become payable. */
export async function verifyMerchantDomain(userId: string, merchantId: string) {
  const [m] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
  if (!m || m.source !== "onboarded") throw new Error("Merchant not found");
  const url = `${normaliseStoreUrl(m.baseUrl)}${WELL_KNOWN}`;
  let file: WellKnown;
  try {
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000), cache: "no-store", headers: { Accept: "application/json", "User-Agent": "MandateGateway/1.0" } });
    if (!res.ok) throw new Error(`the store returned ${res.status}`);
    file = JSON.parse((await res.text()).slice(0, 20_000));
  } catch (e) { throw new Error(`Could not read ${url}: ${e instanceof Error ? e.message : e}`); }
  // The caller must be the registrant, or hold a token of their own for this store.
  const [claim] = m.registeredBy === userId ? [] : await db.select().from(merchantClaims).where(and(eq(merchantClaims.merchantId, m.id), eq(merchantClaims.userId, userId)));
  const expected = m.registeredBy === userId ? m.verificationToken : claim?.token ?? null;
  if (!expected) throw new Error("Register this store's address from this browser first, to get an ownership token");
  if (file.mandate_verification !== expected) throw new Error(`${url} does not contain the ownership token issued to this browser yet`);
  const payee = { paypalMerchantId: file.paypal?.merchant_id?.slice(0, 40) || null, paypalEmail: file.paypal?.email?.slice(0, 120) || null };
  if (!payee.paypalMerchantId && !payee.paypalEmail) throw new Error("The file must name the store's PayPal account under paypal.merchant_id or paypal.email");
  const problem = await payeeProblem({ merchantId: payee.paypalMerchantId, email: payee.paypalEmail });
  if (problem) throw new Error(`${problem} Put the store's own PayPal business account under "paypal" in the file (merchant_id or email), then check again.`);
  const payeeChanged = !!m.domainVerifiedAt && (m.paypalMerchantId !== payee.paypalMerchantId || m.paypalEmail !== payee.paypalEmail);
  // Callback URLs must live under the store's own verified base URL.
  const under = (v: string | undefined) => (typeof v === "string" && (v === m.baseUrl || v.startsWith(`${m.baseUrl}/`)) ? v : null);
  const [row] = await db.update(merchants).set({ ...payee, name: (file.name ?? m.name).slice(0, 80), ordersUrl: under(file.orders_url), returnsUrl: under(file.returns_url), catalogUrl: under(file.catalog_url),
    // Whoever published their token is the registrant from now on.
    registeredBy: userId, verificationToken: expected,
    // A store that changes where its money goes is reviewed again before "verified stores only" mandates pay it.
    ...(payeeChanged ? { verified: false } : {}),
    // A store may take reserved payments only if it can be told about orders, since that is how it learns to ship and to release.
    supportsHold: file.holds === true && !!under(file.orders_url), domainVerifiedAt: new Date() })
    .where(eq(merchants.id, m.id)).returning();
  await db.delete(merchantClaims).where(eq(merchantClaims.merchantId, m.id));
  await append({ userId, type: "merchant.verified", payload: { merchantId: m.id, baseUrl: m.baseUrl, name: row.name, payee, ...(claim ? { registrantChanged: true } : {}), ...(payeeChanged ? { payeeChanged: true, verificationWithdrawn: m.verified } : {}) } });
  return row;
}

// ---- Operator review ---------------------------------------------------------------------------

/** Ledger entries for decisions made by the gateway's operator are filed under this id, not under any user. */
export const OPERATOR_USER = "usr_gateway_operator";
const operatorRow = () => db.insert(schema.users).values({ id: OPERATOR_USER }).onConflictDoNothing();

/**
 * "Verified" is the operator's judgement that a store is who it says it is and is fit to be paid under mandates
 * that say "known merchants only". Proving a domain does not grant it; only this does.
 */
export async function setMerchantVerified(merchantId: string, verified: boolean) {
  const [m] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
  if (!m) throw new Error("Merchant not found");
  if (verified && m.source === "onboarded" && !m.domainVerifiedAt) throw new Error("This store has not proved it controls its website yet");
  if (verified && !m.paypalMerchantId && !m.paypalEmail) throw new Error("This store has no PayPal payee on file");
  const [row] = await db.update(merchants).set({ verified }).where(eq(merchants.id, merchantId)).returning();
  await operatorRow();
  await append({ userId: OPERATOR_USER, type: "merchant.reviewed", payload: { merchantId, baseUrl: m.baseUrl, name: m.name, verified } });
  return row;
}

/** Take a store out of the registry. A store that has been paid stays, so its purchase records keep their merchant. */
export async function removeMerchant(merchantId: string) {
  const [m] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
  if (!m) throw new Error("Merchant not found");
  if (m.source === "builtin") throw new Error("The demo stores that ship with the gateway cannot be removed");
  const [used] = await db.select({ id: schema.purchases.id }).from(schema.purchases).where(eq(schema.purchases.merchantId, merchantId)).limit(1);
  if (used) throw new Error("This store has purchases on record, so it cannot be removed. Withdraw its verified status instead.");
  await db.delete(merchants).where(eq(merchants.id, merchantId));
  await operatorRow();
  await append({ userId: OPERATOR_USER, type: "merchant.removed", payload: { merchantId, baseUrl: m.baseUrl, name: m.name } });
}

/** The registry. A pending store's verification token is shown only to the user who registered it. */
export async function listMerchants(userId?: string) {
  await ensureSeed();
  const rows = await db.select().from(merchants).orderBy(desc(merchants.verified), merchants.name);
  const claims = userId ? await db.select().from(merchantClaims).where(eq(merchantClaims.userId, userId)) : [];
  const claimFor = (id: string) => claims.find((c) => c.merchantId === id)?.token ?? null;
  return rows.map((m) => ({
    id: m.id, name: m.name, baseUrl: m.baseUrl, source: m.source,
    trust: m.verified ? ("verified" as const) : m.source === "builtin" || m.domainVerifiedAt ? ("registered" as const) : ("pending" as const),
    payable: (m.source === "builtin" || !!m.domainVerifiedAt) && !!(m.paypalMerchantId || m.paypalEmail),
    verificationToken: !userId ? null : m.registeredBy === userId ? (m.domainVerifiedAt ? null : m.verificationToken) : claimFor(m.id),
    registeredByMe: !!userId && m.registeredBy === userId,
    /** This browser has asked to manage a store someone else registered, and has not yet published its token. */
    claiming: !!userId && m.registeredBy !== userId && !!claimFor(m.id), wellKnownUrl: m.source === "onboarded" ? `${m.baseUrl}${WELL_KNOWN}` : null,
    domainVerifiedAt: m.domainVerifiedAt?.toISOString() ?? null, createdAt: m.createdAt.toISOString(),
  }));
}
