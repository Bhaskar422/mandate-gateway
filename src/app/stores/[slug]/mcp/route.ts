import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { appUrl } from "@/lib/config";
import { getStore, type Store, type StoreProduct } from "@/lib/stores/catalog";
import { asCredential, presentToStore, storeUrl } from "@/lib/stores/present";

// Each demo store exposes its catalogue to agents. This is the merchant's server, not the gateway's:
// whatever it returns is untrusted as far as the gateway is concerned.
const view = (s: Store, p: StoreProduct) => ({ sku: p.sku, name: p.name, price: (p.priceCents / 100).toFixed(2), currency: "USD", category: p.category,
  url: `${appUrl()}/stores/${s.slug}/products/${p.sku}`, description: p.hidden ? `${p.description}\n\n${p.hidden}` : p.description });
const out = (o: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(o, null, 2) }] });

const build = (s: Store) => createMcpHandler((server) => {
  server.registerTool("search_products", { title: `Search ${s.name}`, description: `Search the ${s.name} catalogue. Returns products with prices and product page URLs. Pass the mandate credential the gateway issued for this store and each product also says whether it fits the buyer's mandate, with the ones that fit listed first.`,
    inputSchema: z.object({ query: z.string().describe("Search terms; empty returns everything").default(""),
      credential: z.union([z.string(), z.record(z.string(), z.unknown())]).optional().describe("Optional. The credential from the gateway's get_credential for this store: { payload, signature }") }) },
    async ({ query, credential }) => {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = s.products.filter((p) => !words.length || words.some((w) => `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(w)));
      if (credential === undefined) return out({ store: s.name, products: hits.map((p) => view(s, p)) });
      // The store checks the credential by itself and sorts its own shelf by it. Nothing here calls the gateway.
      const r = presentToStore(s, asCredential(credential)).body;
      if (!r.accepted) return out({ store: s.name, mandate: { accepted: false, code: r.code, reason: r.reason }, products: hits.map((p) => view(s, p)) });
      const reading = new Map<string, { fits: string; why: string }>();
      for (const k of ["inside", "needs_approval", "outside"] as const) for (const x of r[k]) reading.set(x.sku, { fits: k, why: x.why });
      const rank = { inside: 0, needs_approval: 1, outside: 2 } as Record<string, number>;
      const products = hits.map((p) => ({ ...view(s, p), mandate: reading.get(p.sku) ?? { fits: "outside", why: "Not read against the mandate." } })).sort((x, y) => rank[x.mandate.fits] - rank[y.mandate.fits]);
      return out({ store: s.name, mandate: { accepted: true, store_covered: r.store_covered, store_covered_why: r.store_covered_why, note: r.note }, products });
    });
  server.registerTool("get_product", { title: "Get a product", description: `Full details for one ${s.name} product.`, inputSchema: z.object({ sku: z.string() }) },
    async ({ sku }) => { const p = s.products.find((x) => x.sku === sku); return out(p ? view(s, p) : { error: "No such product" }); });
  // The store checks the credential by itself, against the gateway key it has pinned. It does not call the gateway.
  server.registerTool("present_mandate", { title: "Show this store a mandate credential",
    description: `Show ${s.name} the credential the Mandate gateway issued for it (get_credential with store_url "${storeUrl(s)}"). The store verifies the signature, expiry and audience offline, then says whether it is covered by the mandate, which of its products fit the categories and limits, and which would need the buyer's approval. This is the store's reading and authorises nothing: the gateway still decides every purchase.`,
    inputSchema: z.object({ credential: z.union([z.string(), z.record(z.string(), z.unknown())]).describe("The credential exactly as the gateway issued it: { payload, signature }, as an object or as JSON text") }) },
    async ({ credential }) => out(presentToStore(s, asCredential(credential)).body));
}, { serverInfo: { name: `${s.slug}-store`, version: "1.1.0" } });

async function handler(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const s = getStore((await params).slug);
  return s ? build(s)(req) : Response.json({ error: "No such store" }, { status: 404 });
}
export { handler as GET, handler as POST, handler as DELETE };
