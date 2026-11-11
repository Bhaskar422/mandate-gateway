import { createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, sign, verify } from "node:crypto";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, schema, type Tx } from "./db";
import { canonical, sha256 } from "./ids";

export const GENESIS = "0".repeat(64);
export type LedgerType =
  | "mandate.confirmed" | "mandate.revoked" | "paypal.linked" | "paypal.signed_in" | "purchase.requested" | "purchase.decided"
  | "purchase.approved_by_user" | "purchase.declined_by_user" | "payment.captured" | "payment.failed"
  | "problem.reported" | "refund.requested" | "refund.completed" | "merchant.declined" | "dispute.opened" | "dispute.evidence_submitted" | "webhook.received"
  | "settlement.offer" | "settlement.counter" | "settlement.accepted" | "settlement.declined"
  | "agent.paused" | "agent.resumed" | "agent.revoked" | "agent.key_rotated" | "account.frozen" | "account.unfrozen" | "merchant.registered" | "merchant.verified" | "merchant.reviewed" | "merchant.removed" | "payment.authorized" | "payment.voided" | "claim.assessed";

function keys() {
  const pem = process.env.LEDGER_SIGNING_KEY ? Buffer.from(process.env.LEDGER_SIGNING_KEY, "base64").toString("utf8") : null;
  const g = globalThis as unknown as { __ledgerKey?: string };
  if (!pem && !g.__ledgerKey) {
    if (process.env.NODE_ENV === "production") throw new Error("LEDGER_SIGNING_KEY is required in production");
    g.__ledgerKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  }
  const priv = createPrivateKey(pem ?? g.__ledgerKey!);
  return { priv, pub: createPublicKey(priv) };
}
export const publicKeyPem = () => keys().pub.export({ type: "spki", format: "pem" }) as string;
/**
 * 32 bytes derived from the gateway's signing key for one named purpose (HKDF-SHA256). The demo stores that run
 * inside this app get their own keys this way, so they need no secret of their own. Without LEDGER_SIGNING_KEY it
 * follows the in-memory development key, so it changes when the process restarts.
 */
export const derivedSecret = (purpose: string) =>
  new Uint8Array(hkdfSync("sha256", keys().priv.export({ type: "pkcs8", format: "der" }), new Uint8Array(0), purpose, 32));

const entryHash = (prevHash: string, e: { userId: string; purchaseId: string | null; type: string; payload: unknown; at: string }) =>
  sha256(`${prevHash}\n${canonical({ userId: e.userId, purchaseId: e.purchaseId, type: e.type, payload: e.payload, at: e.at })}`);

/** Append one entry. Serialised with an advisory lock so the chain never forks. */
export async function append(e: { userId: string; purchaseId?: string | null; type: LedgerType; payload: Record<string, unknown> }, tx?: Tx) {
  const run = async (t: Tx) => {
    await t.execute(sql`select pg_advisory_xact_lock(7226001)`);
    const [last] = await t.select({ hash: schema.ledger.hash }).from(schema.ledger).orderBy(desc(schema.ledger.seq)).limit(1);
    const prevHash = last?.hash ?? GENESIS;
    const at = new Date().toISOString();
    // Round-trip through JSON so the hash covers exactly what Postgres stores.
    const payload = JSON.parse(JSON.stringify(e.payload)) as Record<string, unknown>;
    const body = { userId: e.userId, purchaseId: e.purchaseId ?? null, type: e.type, payload, at };
    const hash = entryHash(prevHash, body);
    const signature = sign(null, Buffer.from(hash, "hex"), keys().priv).toString("base64");
    const [row] = await t.insert(schema.ledger).values({ ...body, prevHash, hash, signature }).returning();
    return row;
  };
  return tx ? run(tx) : db.transaction(run);
}

export type LedgerRow = typeof schema.ledger.$inferSelect;

/** Sign any JSON value with the gateway's key, e.g. a credential an agent presents to a merchant. */
export function signPayload<T extends Record<string, unknown>>(payload: T) {
  return { payload, signature: sign(null, Buffer.from(canonical(payload)), keys().priv).toString("base64"), algorithm: "ed25519 over canonical JSON" as const };
}
export function verifyPayload(signed: { payload?: unknown; signature?: unknown }) {
  try { return typeof signed.signature === "string" && verify(null, Buffer.from(canonical(signed.payload)), keys().pub, Buffer.from(signed.signature, "base64")); } catch { return false; }
}
/** The current head of the chain. Publishing it lets anyone later prove the ledger was not rewritten. */
export async function ledgerHead() {
  const [last] = await db.select({ seq: schema.ledger.seq, hash: schema.ledger.hash, at: schema.ledger.at }).from(schema.ledger).orderBy(desc(schema.ledger.seq)).limit(1);
  return signPayload({ entries: last?.seq ?? 0, head: last?.hash ?? GENESIS, headAt: last?.at ?? null, observedAt: new Date().toISOString() });
}

/** Recompute every hash and signature. Any edited, removed or reordered row breaks the chain. */
export function verifyRows(rows: LedgerRow[], pubPem: string, startPrev = GENESIS) {
  const pub = createPublicKey(pubPem);
  let prev = startPrev;
  for (const r of rows) {
    if (r.prevHash !== prev) return { ok: false as const, brokenAt: r.seq, why: "previous-hash link is broken" };
    if (entryHash(prev, r) !== r.hash) return { ok: false as const, brokenAt: r.seq, why: "content does not match its hash" };
    if (!verify(null, Buffer.from(r.hash, "hex"), pub, Buffer.from(r.signature, "base64"))) return { ok: false as const, brokenAt: r.seq, why: "signature is invalid" };
    prev = r.hash;
  }
  return { ok: true as const, entries: rows.length, head: prev };
}

export async function verifyChain() {
  const rows = await db.select().from(schema.ledger).orderBy(asc(schema.ledger.seq));
  return verifyRows(rows, publicKeyPem());
}

/** The evidence bundle for one purchase: its entries plus what is needed to verify them offline. */
export async function evidenceBundle(purchaseId: string) {
  const entries = await db.select().from(schema.ledger).where(eq(schema.ledger.purchaseId, purchaseId)).orderBy(asc(schema.ledger.seq));
  return { purchaseId, publicKey: publicKeyPem(), algorithm: "sha256 hash chain, ed25519 signature over each hash", entries };
}

/** Verify a bundle someone hands you (e.g. a merchant checking a refund request). Checks each entry on its own. */
export function verifyBundle(b: { publicKey: string; entries: LedgerRow[] }, trustedPublicKey: string) {
  if (b.publicKey.trim() !== trustedPublicKey.trim()) return { ok: false as const, why: "bundle is not signed by the trusted gateway key" };
  for (const r of b.entries) {
    const one = verifyRows([r], trustedPublicKey, r.prevHash);
    if (!one.ok) return { ok: false as const, why: `entry ${r.seq}: ${one.why}` };
  }
  return { ok: true as const };
}
