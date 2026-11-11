// What the operator, and stores themselves, have changed about who can be paid. Read from the signed ledger, so the
// operator's own decisions are as checkable as everything else.
import { desc, inArray } from "drizzle-orm";
import { db, schema } from "./db";

export type OperatorEvent = { seq: number; at: string; what: string; store: string; detail: string | null; tone: "ok" | "warn" | "neutral" };

type P = { name?: string; baseUrl?: string; verified?: boolean; payeeChanged?: boolean; verificationWithdrawn?: boolean; registrantChanged?: boolean; keyChanged?: boolean };
export async function operatorLog(limit = 25): Promise<OperatorEvent[]> {
  const rows = await db.select().from(schema.ledger).where(inArray(schema.ledger.type, ["merchant.reviewed", "merchant.verified", "merchant.removed"])).orderBy(desc(schema.ledger.seq)).limit(limit);
  return rows.map((r) => {
    const p = (r.payload ?? {}) as P, store = p.name ?? p.baseUrl ?? "a store";
    const at = new Date(r.at).toISOString();
    if (r.type === "merchant.reviewed") return { seq: r.seq, at, store, what: p.verified ? "Operator verified the store" : "Operator withdrew verification", detail: null, tone: p.verified ? "ok" as const : "warn" as const };
    if (r.type === "merchant.removed") return { seq: r.seq, at, store, what: "Operator removed the store", detail: null, tone: "warn" as const };
    const notes = [p.payeeChanged && "its PayPal account changed", p.keyChanged && "its signing key changed", p.registrantChanged && "it is now managed from another browser", p.verificationWithdrawn && "verification was withdrawn until reviewed again"].filter(Boolean);
    return { seq: r.seq, at, store, what: "Store proved its site and was read", detail: notes.length ? notes.join("; ") : null, tone: notes.length ? "warn" as const : "neutral" as const };
  });
}
