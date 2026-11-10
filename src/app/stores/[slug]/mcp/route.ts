import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { appUrl } from "@/lib/config";
import { getStore, type Store, type StoreProduct } from "@/lib/stores/catalog";

// Each demo store exposes its catalogue to agents. This is the merchant's server, not the gateway's:
// whatever it returns is untrusted as far as the gateway is concerned.
const view = (s: Store, p: StoreProduct) => ({ sku: p.sku, name: p.name, price: (p.priceCents / 100).toFixed(2), currency: "USD", category: p.category,
  url: `${appUrl()}/stores/${s.slug}/products/${p.sku}`, description: p.hidden ? `${p.description}\n\n${p.hidden}` : p.description });
const out = (o: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(o, null, 2) }] });

const build = (s: Store) => createMcpHandler((server) => {
  server.registerTool("search_products", { title: `Search ${s.name}`, description: `Search the ${s.name} catalogue. Returns products with prices and product page URLs.`,
    inputSchema: z.object({ query: z.string().describe("Search terms; empty returns everything").default("") }) },
    async ({ query }) => {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = s.products.filter((p) => !words.length || words.some((w) => `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(w)));
      return out({ store: s.name, products: hits.map((p) => view(s, p)) });
    });
  server.registerTool("get_product", { title: "Get a product", description: `Full details for one ${s.name} product.`, inputSchema: z.object({ sku: z.string() }) },
    async ({ sku }) => { const p = s.products.find((x) => x.sku === sku); return out(p ? view(s, p) : { error: "No such product" }); });
}, { serverInfo: { name: `${s.slug}-store`, version: "1.0.0" } });

async function handler(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const s = getStore((await params).slug);
  return s ? build(s)(req) : Response.json({ error: "No such store" }, { status: 404 });
}
export { handler as GET, handler as POST, handler as DELETE };
