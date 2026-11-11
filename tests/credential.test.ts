import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CREDENTIAL_TTL_MS, credentialPayload } from "../src/lib/credential";
import { publicKeyPem, signPayload } from "../src/lib/ledger";
import { normalizeRules } from "../src/lib/rules";
import { canonical, normalizeAudience, payloadProblem, presentMandate, readMandate, verifyCredential, type CredentialPayload, type StoreView } from "../src/lib/stores/verify-mandate";

const NOW = Date.parse("2026-11-11T12:00:00.000Z");
const STORE = "https://shop.example/stores/stride";
const rules = normalizeRules({ summary: "SECRET-SUMMARY up to $150 on running shoes", currency: "USD", totalLimitCents: 15000, approvalThresholdCents: 10000, perPurchaseLimitCents: 14000,
  allowedCategories: ["running shoes"], merchantPolicy: "verified_only", allowedMerchants: ["Hidden Store"], blockedMerchants: ["Kickz Outlet"], expiresAt: "2026-11-18T12:00:00.000Z" });
const payload = (over: Partial<Parameters<typeof credentialPayload>[0]> = {}) => credentialPayload({ issuer: "https://gateway.example", agentId: "agt_1", audience: STORE,
  mandates: [{ id: "mnd_1", rulesHash: "abc", rules, committedCents: 8900 }], neverBuy: ["Kickz Outlet", "Kickz Outlet"], now: NOW, ...over });
const key = publicKeyPem();
const check = (c: unknown, audience: string | null = STORE, now = NOW + 60_000) => verifyCredential(c, { publicKeyPem: key, audience, now });

const store: StoreView = { name: "Stride Running Co.", url: STORE, verified: true, products: [
  { sku: "TEMPO", name: "Tempo 3", priceCents: 5900, category: "Running shoes", url: `${STORE}/products/TEMPO` },
  { sku: "CARBON", name: "Carbon Racer", priceCents: 13500, category: "Running shoes", url: `${STORE}/products/CARBON` },
  { sku: "GIFT", name: "Gift Card $50", priceCents: 5000, category: "Gift cards", url: `${STORE}/products/GIFT` },
  { sku: "SOCK", name: "Trail Sock", priceCents: 1800, category: "Running apparel", url: `${STORE}/products/SOCK` },
] };

describe("mandate credential: what it says", () => {
  const p = payload();
  it("carries the bounds a store can act on", () => {
    expect(p).toMatchObject({ type: "mandate.authorisation", version: 1, issuer: "https://gateway.example", agent: { id: "agt_1" }, audience: STORE, neverBuy: ["Kickz Outlet"] });
    expect(p.id).toMatch(/^cred_/);
    expect(Date.parse(p.expiresAt) - Date.parse(p.issuedAt)).toBe(CREDENTIAL_TTL_MS);
    expect(CREDENTIAL_TTL_MS).toBeLessThanOrEqual(15 * 60_000);
    expect(p.mandates[0]).toEqual({ id: "mnd_1", rulesHash: "abc", currency: "USD", remainingCents: 6100, perPurchaseLimitCents: 14000, approvalThresholdCents: 10000,
      allowedCategories: ["running shoes"], merchantPolicy: "verified_only", allowedMerchants: [], expiresAt: "2026-11-18T12:00:00.000Z" });
    expect(payloadProblem(p)).toBeNull();
  });
  it("names the stores only when the mandate names them", () => {
    const named = payload({ mandates: [{ id: "m", rulesHash: "h", rules: { ...rules, merchantPolicy: "allowlist", allowedMerchants: ["shop.example"] }, committedCents: 0 }] });
    expect(named.mandates[0].allowedMerchants).toEqual(["shop.example"]);
  });
  it("never reports a negative remaining budget", () => expect(payload({ mandates: [{ id: "m", rulesHash: "h", rules, committedCents: 99999 }] }).mandates[0].remainingCents).toBe(0));
  it("holds no payment details, buyer identity or mandate text", () => {
    const keys = new Set<string>();
    const walk = (v: unknown) => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) keys.add(k); walk(x); } };
    walk(p);
    expect([...keys].sort()).toEqual(["agent", "allowedCategories", "allowedMerchants", "approvalThresholdCents", "audience", "currency", "expiresAt", "id", "issuedAt", "issuer", "mandates",
      "merchantPolicy", "neverBuy", "note", "perPurchaseLimitCents", "remainingCents", "rulesHash", "type", "version"]);
    for (const k of keys) expect(k).not.toMatch(/email|user|payer|vault|paypal|card|token|key|name|summary|text|address/i);
    const text = JSON.stringify(signPayload(p));
    expect(text).not.toContain("SECRET-SUMMARY");
    expect(text).not.toContain("Hidden Store");
  });
});

describe("mandate credential: offline verification", () => {
  it("round-trips, also through JSON and with keys in another order", () => {
    const signed = signPayload(payload());
    expect(check(signed)).toMatchObject({ ok: true, payload: { agent: { id: "agt_1" } } });
    const wire = JSON.parse(JSON.stringify(signed)) as typeof signed;
    const reordered = { signature: wire.signature, payload: Object.fromEntries(Object.entries(wire.payload).reverse()) };
    expect(check(reordered).ok).toBe(true);
  });
  it("is signed over the canonical JSON of the payload with Ed25519", () => {
    const pair = generateKeyPairSync("ed25519"), p = payload();
    const signed = { payload: p, signature: sign(null, Buffer.from(canonical(p)), pair.privateKey).toString("base64") };
    expect(verifyCredential(signed, { publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }) as string, audience: STORE, now: NOW }).ok).toBe(true);
    expect(check(signed)).toMatchObject({ ok: false, code: "bad_signature" });
  });
  it("rejects a tampered payload", () => {
    const signed = signPayload(payload());
    const richer = { ...signed, payload: { ...signed.payload, mandates: [{ ...signed.payload.mandates[0], remainingCents: 999999 }] } };
    expect(check(richer)).toMatchObject({ ok: false, code: "bad_signature" });
    expect(check({ ...signed, payload: { ...signed.payload, audience: "https://other.example" } }, "https://other.example")).toMatchObject({ ok: false, code: "bad_signature" });
    expect(check({ ...signed, payload: { ...signed.payload, expiresAt: "2099-01-01T00:00:00.000Z" } })).toMatchObject({ ok: false, code: "bad_signature" });
    expect(check({ payload: signed.payload, signature: "not-a-signature" })).toMatchObject({ ok: false, code: "bad_signature" });
  });
  it("rejects an expired credential", () => {
    const signed = signPayload(payload());
    expect(check(signed, STORE, NOW + CREDENTIAL_TTL_MS - 1).ok).toBe(true);
    expect(check(signed, STORE, NOW + CREDENTIAL_TTL_MS)).toMatchObject({ ok: false, code: "expired" });
  });
  it("rejects one dated in the future or valid for too long", () => {
    expect(check(signPayload(payload()), STORE, NOW - 10 * 60_000)).toMatchObject({ ok: false, code: "not_yet_valid" });
    expect(check(signPayload({ ...payload(), expiresAt: "2026-11-12T12:00:00.000Z" }))).toMatchObject({ ok: false, code: "expired" });
  });
  it("rejects the wrong audience and an unbound credential", () => {
    expect(check(signPayload(payload()), "https://shop.example/stores/kickz")).toMatchObject({ ok: false, code: "wrong_audience" });
    expect(check(signPayload(payload({ audience: null })))).toMatchObject({ ok: false, code: "unbound" });
    expect(check(signPayload(payload({ audience: null })), null).ok).toBe(true);
    expect(check(signPayload(payload()), `${STORE}/`).ok).toBe(true);
  });
  it("rejects a pinned issuer mismatch", () => {
    expect(verifyCredential(signPayload(payload()), { publicKeyPem: key, audience: STORE, issuer: "https://other-gateway.example", now: NOW })).toMatchObject({ ok: false, code: "wrong_issuer" });
  });
  it("rejects missing fields, even when signed by the gateway", () => {
    const full = payload() as unknown as Record<string, unknown>;
    for (const field of ["type", "version", "id", "issuer", "agent", "audience", "issuedAt", "expiresAt", "mandates", "neverBuy"]) {
      const { [field]: _gone, ...rest } = full;
      expect(check(signPayload(rest)), field).toMatchObject({ ok: false, code: "malformed" });
    }
    for (const field of ["id", "currency", "remainingCents", "perPurchaseLimitCents", "approvalThresholdCents", "allowedCategories", "merchantPolicy", "allowedMerchants", "expiresAt"]) {
      const { [field]: _gone, ...m } = payload().mandates[0] as unknown as Record<string, unknown>;
      expect(check(signPayload({ ...full, mandates: [m] })), `mandates[0].${field}`).toMatchObject({ ok: false, code: "malformed" });
    }
    expect(check(signPayload({ ...full, mandates: [] }))).toMatchObject({ ok: false, code: "malformed" });
    expect(check(signPayload({ entries: 3, head: "0".repeat(64) }))).toMatchObject({ ok: false, code: "malformed" }); // another thing the gateway signs
    for (const junk of [null, "x", 7, {}, { payload: payload() }, { signature: "x" }]) expect(check(junk)).toMatchObject({ ok: false, code: "malformed" });
  });
  it("normalises store addresses", () => {
    expect(normalizeAudience("HTTPS://Shop.Example/stores/stride/")).toBe(STORE);
    expect(normalizeAudience("https://shop.example/")).toBe("https://shop.example");
    for (const bad of ["", "shop.example", "ftp://shop.example", "https://user:pw@shop.example", 5, null]) expect(normalizeAudience(bad)).toBeNull();
  });
});

describe("mandate credential: the store's answer", () => {
  const read = (p: CredentialPayload, s = store) => readMandate(p, s, NOW);
  it("sorts the catalogue by category and price", () => {
    const r = read(payload());
    expect(r).toMatchObject({ accepted: true, store_covered: "yes", credential: { agent_id: "agt_1", audience: STORE } });
    expect(r.inside.map((x) => x.sku)).toEqual(["TEMPO"]);
    expect(r.outside.map((x) => x.sku)).toEqual(["CARBON", "GIFT", "SOCK"]); // $135 is more than the $61 left
    expect(r.note).toMatch(/authorises nothing/);
    expect(r.note).toMatch(/gateway/);
  });
  it("says what would need the buyer's approval", () => {
    const r = read(payload({ mandates: [{ id: "m", rulesHash: "h", rules, committedCents: 0 }] }));
    expect(r.needs_approval.map((x) => x.sku)).toEqual(["CARBON"]);
    expect(r.needs_approval[0].why).toMatch(/\$100\.00/);
  });
  it("applies the per-purchase limit", () => {
    const r = read(payload({ mandates: [{ id: "m", rulesHash: "h", rules: { ...rules, perPurchaseLimitCents: 5000 }, committedCents: 0 }] }));
    expect(r.inside).toEqual([]);
    expect(r.outside.find((x) => x.sku === "TEMPO")?.why).toMatch(/limit for one purchase/);
  });
  it("reads the store policy as far as a store can", () => {
    expect(read(payload(), { ...store, verified: undefined }).store_covered).toBe("unknown");
    expect(read(payload(), { ...store, verified: false })).toMatchObject({ store_covered: "no", inside: [], needs_approval: [] });
    const allow = (list: string[]) => read(payload({ mandates: [{ id: "m", rulesHash: "h", rules: { ...rules, merchantPolicy: "allowlist", allowedMerchants: list }, committedCents: 0 }] })).store_covered;
    expect(allow(["shop.example"])).toBe("yes");
    expect(allow(["stride running co."])).toBe("yes");
    expect(allow(["Other Shop"])).toBe("no");
    expect(read(payload({ neverBuy: ["shop.example"] }))).toMatchObject({ store_covered: "no", inside: [] });
    expect(read(payload({ mandates: [{ id: "m", rulesHash: "h", rules: { ...rules, merchantPolicy: "any_registered" }, committedCents: 0 }] }), { ...store, verified: false }).store_covered).toBe("yes");
  });
  it("uses the best reading across several mandates and skips one that has ended", () => {
    const socks = { id: "m2", rulesHash: "h2", rules: { ...rules, allowedCategories: ["running apparel"] }, committedCents: 0 };
    const ended = { id: "m3", rulesHash: "h3", rules: { ...rules, allowedCategories: ["gift cards"], expiresAt: "2026-11-01T00:00:00.000Z" }, committedCents: 0 };
    const r = read(payload({ mandates: [{ id: "mnd_1", rulesHash: "abc", rules, committedCents: 8900 }, socks, ended] }));
    expect(r.inside.map((x) => x.sku)).toEqual(["TEMPO", "SOCK"]);
    expect(r.outside.map((x) => x.sku)).toContain("GIFT");
  });
  it("answers a bad credential with a reason and a status", () => {
    const o = { publicKeyPem: key, now: NOW };
    expect(presentMandate(signPayload(payload()), store, o)).toMatchObject({ status: 200, body: { accepted: true } });
    expect(presentMandate(signPayload(payload()), { ...store, url: "https://elsewhere.example" }, o)).toMatchObject({ status: 401, body: { accepted: false, code: "wrong_audience" } });
    expect(presentMandate({ nonsense: true }, store, o)).toMatchObject({ status: 400, body: { accepted: false, code: "malformed" } });
  });
});
