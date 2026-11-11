import { generateKeyPairSync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAX_SKEW_SECONDS, REQUEST_ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, memoryReplayStore, privateKeyFromSeed, publicPemOf, readSigningKey, signRequest, signingString, verifyRequest } from "../src/lib/stores/sign-request";

const pair = () => { const k = generateKeyPairSync("ed25519"); return { priv: k.privateKey, pub: k.publicKey.export({ type: "spki", format: "pem" }) as string }; };
const store = pair(), other = pair();
const req = { method: "POST", path: "/api/merchant/shipments", body: JSON.stringify({ purchaseId: "pur_1", authorizationId: "AUTH1", tracking: "T1" }) };
const NOW = 1_800_000_000_000;

describe("signed store requests", () => {
  it("accepts a request signed with the store's key", async () => {
    const headers = signRequest(store.priv, req, { now: NOW });
    const v = await verifyRequest(store.pub, { ...req, headers }, { now: NOW, firstUse: memoryReplayStore() });
    expect(v).toMatchObject({ ok: true, requestId: headers[REQUEST_ID_HEADER], timestamp: NOW / 1000 });
  });

  it("reads headers from a Headers object, whatever their case", async () => {
    const headers = new Headers(signRequest(store.priv, req, { now: NOW }));
    expect((await verifyRequest(store.pub, { ...req, headers }, { now: NOW, firstUse: memoryReplayStore() })).ok).toBe(true);
  });

  it("signs the method, path, body hash, timestamp and request id, one per line", () => {
    expect(signingString({ method: "get", path: "/x?a=1", body: "", timestamp: "5", requestId: "abcdefgh" }))
      .toBe("GET\n/x?a=1\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n5\nabcdefgh");
  });

  it("refuses a request with no signature headers", async () => {
    const v = await verifyRequest(store.pub, { ...req, headers: {} }, { now: NOW, firstUse: memoryReplayStore() });
    expect(v).toMatchObject({ ok: false, code: "missing_signature" });
  });

  it("refuses a tampered body", async () => {
    const headers = signRequest(store.priv, req, { now: NOW });
    const v = await verifyRequest(store.pub, { ...req, body: req.body.replace("pur_1", "pur_2"), headers }, { now: NOW, firstUse: memoryReplayStore() });
    expect(v).toMatchObject({ ok: false, code: "bad_signature" });
  });

  it("refuses a signature moved to another path or method", async () => {
    const headers = signRequest(store.priv, req, { now: NOW });
    expect(await verifyRequest(store.pub, { ...req, path: "/api/merchant/evidence/pur_1", headers }, { now: NOW, firstUse: memoryReplayStore() })).toMatchObject({ ok: false, code: "bad_signature" });
    expect(await verifyRequest(store.pub, { ...req, method: "GET", headers }, { now: NOW, firstUse: memoryReplayStore() })).toMatchObject({ ok: false, code: "bad_signature" });
  });

  it("refuses a request signed with another key", async () => {
    const headers = signRequest(other.priv, req, { now: NOW });
    const v = await verifyRequest(store.pub, { ...req, headers }, { now: NOW, firstUse: memoryReplayStore() });
    expect(v).toMatchObject({ ok: false, code: "bad_signature" });
  });

  it("refuses a stale timestamp, and one from the future", async () => {
    const late = (MAX_SKEW_SECONDS + 1) * 1000;
    const old = signRequest(store.priv, req, { now: NOW - late }), ahead = signRequest(store.priv, req, { now: NOW + late });
    expect(await verifyRequest(store.pub, { ...req, headers: old }, { now: NOW, firstUse: memoryReplayStore() })).toMatchObject({ ok: false, code: "stale_timestamp" });
    expect(await verifyRequest(store.pub, { ...req, headers: ahead }, { now: NOW, firstUse: memoryReplayStore() })).toMatchObject({ ok: false, code: "stale_timestamp" });
    const edge = signRequest(store.priv, req, { now: NOW - MAX_SKEW_SECONDS * 1000 });
    expect((await verifyRequest(store.pub, { ...req, headers: edge }, { now: NOW, firstUse: memoryReplayStore() })).ok).toBe(true);
  });

  it("refuses a timestamp changed after signing", async () => {
    const headers = { ...signRequest(store.priv, req, { now: NOW - 3_600_000 }), [TIMESTAMP_HEADER]: String(NOW / 1000) };
    expect(await verifyRequest(store.pub, { ...req, headers }, { now: NOW, firstUse: memoryReplayStore() })).toMatchObject({ ok: false, code: "bad_signature" });
  });

  it("refuses a replayed request id", async () => {
    const firstUse = memoryReplayStore(() => NOW), headers = signRequest(store.priv, req, { now: NOW });
    expect((await verifyRequest(store.pub, { ...req, headers }, { now: NOW, firstUse })).ok).toBe(true);
    expect(await verifyRequest(store.pub, { ...req, headers }, { now: NOW, firstUse })).toMatchObject({ ok: false, code: "replayed" });
  });

  it("does not use up a request id on a request that fails the signature check", async () => {
    const firstUse = memoryReplayStore(() => NOW), good = signRequest(store.priv, req, { now: NOW, requestId: "request-0001" });
    const forged = { ...good, [SIGNATURE_HEADER]: signRequest(other.priv, req, { now: NOW, requestId: "request-0001" })[SIGNATURE_HEADER] };
    expect((await verifyRequest(store.pub, { ...req, headers: forged }, { now: NOW, firstUse })).ok).toBe(false);
    expect((await verifyRequest(store.pub, { ...req, headers: good }, { now: NOW, firstUse })).ok).toBe(true);
  });

  it("refuses a malformed request id or timestamp", async () => {
    const h = signRequest(store.priv, req, { now: NOW, requestId: "short" });
    expect(await verifyRequest(store.pub, { ...req, headers: h }, { now: NOW, firstUse: memoryReplayStore() })).toMatchObject({ ok: false, code: "bad_request_id" });
    expect(await verifyRequest(store.pub, { ...req, headers: { ...h, [TIMESTAMP_HEADER]: "yesterday" } }, { now: NOW, firstUse: memoryReplayStore() })).toMatchObject({ ok: false, code: "bad_timestamp" });
  });

  it("derives the same key from the same seed, and different keys from different seeds", () => {
    const seed = randomBytes(32);
    expect(publicPemOf(privateKeyFromSeed(seed))).toBe(publicPemOf(privateKeyFromSeed(seed)));
    expect(publicPemOf(privateKeyFromSeed(seed))).not.toBe(publicPemOf(privateKeyFromSeed(randomBytes(32))));
    expect(() => privateKeyFromSeed(randomBytes(16))).toThrow();
  });

  it("reads a published key only if it is an Ed25519 public key in PEM form", () => {
    expect(readSigningKey(store.pub)).toBe(store.pub);
    expect(readSigningKey(` ${store.pub.trim()} `)).toBe(store.pub);
    expect(readSigningKey("not a key")).toBeNull();
    expect(readSigningKey(42)).toBeNull();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }) as string;
    expect(readSigningKey(rsa)).toBeNull();
  });
});
