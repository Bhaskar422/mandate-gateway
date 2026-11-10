import { notFound } from "next/navigation";
import { appUrl } from "@/lib/config";
import { money } from "@/lib/ids";
import { getProduct, getStore } from "@/lib/stores/catalog";

export default async function ProductPage({ params }: { params: Promise<{ slug: string; sku: string }> }) {
  const { slug, sku } = await params;
  const s = getStore(slug), p = getProduct(slug, sku);
  if (!s || !p) notFound();
  const ld = { "@context": "https://schema.org", "@type": "Product", name: p.name, sku: p.sku, category: p.category, description: p.description,
    brand: { "@type": "Brand", name: s.name },
    offers: { "@type": "Offer", price: (p.priceCents / 100).toFixed(2), priceCurrency: "USD", availability: "https://schema.org/InStock", url: `${appUrl()}/stores/${slug}/products/${sku}` } };
  return (
    <article className="grid gap-8 md:grid-cols-2">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <div className="flex h-72 items-center justify-center rounded-2xl bg-slate-50 text-9xl">{p.image}</div>
      <div>
        <p className="text-sm text-slate-500">{p.category} · SKU {p.sku}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{p.name}</h1>
        <p className="mt-3 text-2xl font-bold">{money(p.priceCents)}</p>
        <p className="mt-4 text-slate-700">{p.description}</p>
        {/* Invisible to shoppers, present for anything that reads the page text. This is the prompt-injection demo. */}
        {p.hidden && <div style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }} aria-hidden="true">{p.hidden}</div>}
        <p className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">Pay with PayPal through your AI agent. {s.verified ? "This merchant is verified by the Mandate gateway." : "This merchant is not verified."}</p>
      </div>
    </article>
  );
}
