// A wider product search, across stores that have not joined this gateway, through Channel3's catalogue API.
// Nothing found here can be bought through the gateway: the store is not registered, so the policy engine blocks
// it. What it is for: the assistant can still tell the user what exists and where, and every such result is
// counted as demand a store is missing, which is the case put to that store for joining.
import { desc, gte, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { newId } from "./ids";

const API = "https://api.trychannel3.com/v1/search";
export const widerSearchConfigured = () => !!process.env.CHANNEL3_API_KEY;

export type WiderProduct = { title: string; brand: string | null; category: string | null; price: string | null; currency: string | null; store: string; link: string; image: string | null };

const IMAGE_HOST = /^https:\/\/cdn\.trychannel3\.com\/[\w\-.~%/?&=]+$/;

type Raw = { title?: string; images?: { url?: string; cleaned_url?: string; is_main_image?: boolean }[]; brands?: { name?: string }[]; category?: { title?: string }; offers?: { url?: string; domain?: string; availability?: string; price?: { price?: number; currency?: string } }[] };

/** Read one search reply into the few fields the assistant needs. Pure, so the shape is tested without the network. */
export function readProducts(body: unknown, limit = 6): WiderProduct[] {
  const list = (body as { products?: Raw[] } | null)?.products;
  if (!Array.isArray(list)) return [];
  const out: WiderProduct[] = [];
  for (const p of list) {
    const offer = (p.offers ?? []).filter((o) => o.domain && o.url).sort((a, b) => Number(b.availability === "InStock") - Number(a.availability === "InStock") || (a.price?.price ?? Infinity) - (b.price?.price ?? Infinity))[0];
    if (!p.title || !offer) continue;
    // The main picture, from Channel3's own image host only: nothing else is ever loaded into the shopper's page.
    const shots = (p.images ?? []).slice().sort((a, b) => Number(!!b.is_main_image) - Number(!!a.is_main_image));
    const image = shots.map((i) => i.url ?? i.cleaned_url ?? "").find((u) => u.length <= 500 && IMAGE_HOST.test(u)) ?? null;
    out.push({ title: p.title.slice(0, 140), brand: p.brands?.[0]?.name?.slice(0, 60) ?? null, category: p.category?.title?.slice(0, 80) ?? null,
      price: typeof offer.price?.price === "number" ? offer.price.price.toFixed(2) : null, currency: offer.price?.currency ?? null,
      store: offer.domain!.toLowerCase().replace(/^www\./, "").slice(0, 120), link: offer.url!.slice(0, 500), image });
    if (out.length >= limit) break;
  }
  return out;
}

/** Search the wider catalogue. Returns nothing when no key is set or the service does not answer. */
export async function searchWider(query: string, limit = 6): Promise<WiderProduct[]> {
  const key = process.env.CHANNEL3_API_KEY;
  if (!key || !query.trim()) return [];
  try {
    const res = await fetch(API, { method: "POST", headers: { "x-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify({ query: query.slice(0, 200), limit }), signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!res.ok) { console.error("wider search failed:", res.status); return []; }
    return readProducts(await res.json(), limit);
  } catch (e) { console.error("wider search failed:", e); return []; }
}

/** Count each result as demand its store is missing. Holds the store and the product only: no user, no wording of the request. */
export async function recordUnmetDemand(products: WiderProduct[]) {
  if (!products.length) return;
  try {
    await db.insert(schema.unmetDemand).values(products.map((p) => ({ id: newId("dem"), domain: p.store, productTitle: p.title, category: p.category,
      priceCents: p.price ? Math.round(Number(p.price) * 100) : null, currency: p.currency })));
  } catch (e) { console.error("unmet demand could not be recorded:", e); }
}

export type UnmetStore = { domain: string; requests: number; valueCents: number; example: string };
/** The stores agents found products at, but could not buy from, over the last `days` days. */
export async function unmetDemand(days = 14, limit = 8): Promise<UnmetStore[]> {
  try {
    const since = new Date(Date.now() - days * 86_400_000);
    const d = schema.unmetDemand;
    const rows = await db.select({ domain: d.domain, requests: sql<number>`count(*)::int`, valueCents: sql<number>`coalesce(sum(${d.priceCents}), 0)::int`, example: sql<string>`max(${d.productTitle})` })
      .from(d).where(gte(d.createdAt, since)).groupBy(d.domain).orderBy(desc(sql`count(*)`)).limit(limit);
    return rows;
  } catch (e) { console.error("unmet demand could not be read:", e); return []; }
}
