// The gateway's side of signed store requests. A store that has published a signing key must sign every request it
// makes to the gateway; a store that has not is accepted as before, so stores can adopt signing one at a time.
import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "./db";
import { MAX_SKEW_SECONDS, verifyRequest } from "./stores/sign-request";

const { storeRequestIds } = schema;
type Merchant = Pick<typeof schema.merchants.$inferSelect, "id" | "signingKey">;

/** Record a request id for a store. False when that store has used it before. */
async function firstUse(merchantId: string, requestId: string) {
  // Ids older than the timestamp window can never be accepted again, so they need not be kept.
  await db.delete(storeRequestIds).where(and(eq(storeRequestIds.merchantId, merchantId), lt(storeRequestIds.seenAt, new Date(Date.now() - 2 * MAX_SKEW_SECONDS * 1000))));
  const made = await db.insert(storeRequestIds).values({ merchantId, requestId }).onConflictDoNothing().returning({ requestId: storeRequestIds.requestId });
  return made.length === 1;
}

/**
 * Null when the request may proceed: the store has no key on file, or the request is correctly signed with it.
 * Otherwise the 401 to send back. `body` is the raw text of the request body ("" for a GET).
 */
export async function storeSignatureProblem(req: Request, body: string, merchant: Merchant | null | undefined): Promise<Response | null> {
  if (!merchant?.signingKey) return null;
  const u = new URL(req.url);
  const v = await verifyRequest(merchant.signingKey, { method: req.method, path: `${u.pathname}${u.search}`, body, headers: req.headers }, { firstUse: (id) => firstUse(merchant.id, id) });
  return v.ok ? null : Response.json({ error: v.reason, code: v.code }, { status: 401 });
}
