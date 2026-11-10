import { createHash, randomBytes } from "node:crypto";
export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;
export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
/** Deterministic JSON: object keys sorted, so equal values always hash equally. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}
export const money = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
