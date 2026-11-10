import { sha256 } from "./ids";

export type ProductSnapshot = {
  url: string; fetchedAt: string; pageSha256: string;
  name: string; description: string; sku: string | null; category: string | null;
  priceCents: number; currency: string; availability: string | null;
  /** Visible page text, as the agent would have seen it. Kept as evidence. */
  pageText: string;
};

type Ld = Record<string, unknown>;
const flat = (v: unknown): Ld[] => Array.isArray(v) ? v.flatMap(flat) : v && typeof v === "object" ? [v as Ld, ...flat((v as Ld)["@graph"])] : [];

/** Read schema.org Product data from a page. The gateway does this itself: it never trusts the agent's description. */
export function parseProduct(url: string, html: string, now = new Date()): ProductSnapshot | null {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let data: unknown;
    try { data = JSON.parse(b[1]); } catch { continue; }
    const p = flat(data).find((n) => [n["@type"]].flat().includes("Product"));
    if (!p) continue;
    const offer = flat(p.offers)[0];
    const price = Number(offer?.price);
    const currency = String(offer?.priceCurrency ?? "");
    if (!p.name || !Number.isFinite(price) || price <= 0 || currency.length !== 3) continue;
    return {
      url, fetchedAt: now.toISOString(), pageSha256: sha256(html),
      name: String(p.name), description: String(p.description ?? ""), sku: p.sku ? String(p.sku) : null,
      category: p.category ? String(p.category) : null,
      priceCents: Math.round(price * 100), currency: currency.toUpperCase(),
      availability: offer?.availability ? String(offer.availability).split("/").pop()! : null,
      pageText: html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, 6000),
    };
  }
  return null;
}

export async function fetchProduct(url: string): Promise<ProductSnapshot | null> {
  try {
    const res = await fetch(url, { redirect: "error", headers: { "User-Agent": "MandateGateway/1.0", Accept: "text/html" }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!res.ok) return null;
    return parseProduct(url, (await res.text()).slice(0, 2_000_000));
  } catch { return null; }
}
