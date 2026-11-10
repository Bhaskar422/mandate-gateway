import { describe, expect, it } from "vitest";
import { GENESIS, publicKeyPem, signPayload, verifyPayload, verifyRows, type LedgerRow } from "../src/lib/ledger";
import { canonical, sha256 } from "../src/lib/ids";
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";

// Build a chain by hand with a throwaway key, the same way the ledger does.
const pair = generateKeyPairSync("ed25519");
const pub = pair.publicKey.export({ type: "spki", format: "pem" }) as string;
function chain(n: number): LedgerRow[] {
  const rows: LedgerRow[] = [];
  let prev = GENESIS;
  for (let i = 1; i <= n; i++) {
    const body = { userId: "u", purchaseId: "p", type: "purchase.requested", payload: { i }, at: `2026-11-11T00:00:0${i}.000Z` };
    const hash = sha256(`${prev}\n${canonical(body)}`);
    rows.push({ seq: i, ...body, prevHash: prev, hash, signature: sign(null, Buffer.from(hash, "hex"), createPrivateKey(pair.privateKey.export({ type: "pkcs8", format: "pem" }) as string)).toString("base64") });
    prev = hash;
  }
  return rows;
}

describe("evidence ledger", () => {
  it("verifies an intact chain", () => expect(verifyRows(chain(4), pub)).toMatchObject({ ok: true, entries: 4 }));
  it("detects an edited payload", () => {
    const rows = chain(4); rows[1] = { ...rows[1], payload: { i: 99 } };
    expect(verifyRows(rows, pub)).toMatchObject({ ok: false, brokenAt: 2, why: "content does not match its hash" });
  });
  it("detects a removed entry", () => {
    const rows = chain(4); rows.splice(1, 1);
    expect(verifyRows(rows, pub)).toMatchObject({ ok: false, brokenAt: 3 });
  });
  it("detects reordering", () => {
    const rows = chain(3); [rows[1], rows[2]] = [rows[2], rows[1]];
    expect(verifyRows(rows, pub).ok).toBe(false);
  });
  it("rejects a chain signed by a different key", () => expect(verifyRows(chain(2), publicKeyPem())).toMatchObject({ ok: false, why: "signature is invalid" }));
});

describe("signed credentials", () => {
  it("round-trips and is independent of key order", () => {
    const s = signPayload({ b: 2, a: 1 });
    expect(verifyPayload(s)).toBe(true);
    expect(verifyPayload({ payload: { a: 1, b: 2 }, signature: s.signature })).toBe(true);
  });
  it("fails when the payload changes", () => {
    const s = signPayload({ limit: 100 });
    expect(verifyPayload({ payload: { limit: 100000 }, signature: s.signature })).toBe(false);
    expect(verifyPayload({ payload: s.payload, signature: "not-a-signature" })).toBe(false);
  });
});
