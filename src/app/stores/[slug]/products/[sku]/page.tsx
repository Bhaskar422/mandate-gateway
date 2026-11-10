import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, ChevronRight, CircleAlert, PackageCheck } from "lucide-react";
import { money } from "@/components/format";
import ProductTile from "@/components/stores/ProductTile";
import { storeTheme } from "@/components/stores/storeThemes";
import { CopyButton } from "@/components/ui/Copy";
import { appUrl } from "@/lib/config";
import { getProduct, getStore } from "@/lib/stores/catalog";

export default async function ProductPage({ params }: { params: Promise<{ slug: string; sku: string }> }) {
  const { slug, sku } = await params;
  const s = getStore(slug), p = getProduct(slug, sku);
  if (!s || !p) notFound();
  const t = storeTheme(slug);
  const url = `${appUrl()}/stores/${slug}/products/${sku}`;
  // The gateway reads this block to learn the product's name, SKU, category and price. Keep it as it is.
  const ld = { "@context": "https://schema.org", "@type": "Product", name: p.name, sku: p.sku, category: p.category, description: p.description,
    brand: { "@type": "Brand", name: s.name },
    offers: { "@type": "Offer", price: (p.priceCents / 100).toFixed(2), priceCurrency: "USD", availability: "https://schema.org/InStock", url } };
  const others = s.products.filter((x) => x.sku !== p.sku).slice(0, 3);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-1 text-sm text-ink-3">
        <Link href={`/stores/${slug}`} className="hover:text-ink">{s.name}</Link><ChevronRight size={13} aria-hidden /><span>{p.category}</span>
      </nav>
      <article className="grid gap-8 md:grid-cols-2">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
        <div className={`flex h-64 items-center justify-center bg-[var(--accent-soft)] text-[7rem] sm:h-96 sm:text-[9rem] ${t.radius}`}><span aria-hidden>{p.image}</span></div>
        <div>
          <p className="text-sm text-ink-3">{p.category} · SKU {p.sku}</p>
          <h1 className={`mt-1 text-3xl leading-tight text-ink ${t.heading}`}>{p.name}</h1>
          <p className="num mt-3 text-3xl font-bold text-ink">{money(p.priceCents)}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-2"><PackageCheck size={15} className="text-ok" aria-hidden />In stock · {t.shipping}</p>
          <p className="mt-5 text-lg text-ink-2">{p.description}</p>
          {/* Invisible to shoppers, present for anything that reads the page text. This is the prompt-injection demo. */}
          {p.hidden && <div style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }} aria-hidden="true">{p.hidden}</div>}

          <div className={`mt-6 border border-line bg-raised p-4 ${t.radius}`}>
            <p className="font-semibold text-ink">Pay with PayPal through your AI agent</p>
            <p className="mt-1 text-sm text-ink-2">This shop takes orders from shopping agents connected to the Mandate gateway. Give your agent this page; the gateway checks the purchase against your rules and pays from your PayPal wallet.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="code min-w-0 flex-1 break-all rounded-md border border-line bg-surface px-2.5 py-1.5 text-ink-2">{url}</span>
              <CopyButton text={url} label="Copy link" />
            </div>
            <p className={`mt-3 flex items-center gap-1.5 text-sm font-medium ${s.verified ? "text-ok-ink" : "text-warn-ink"}`}>
              {s.verified ? <BadgeCheck size={15} aria-hidden /> : <CircleAlert size={15} aria-hidden />}
              {s.verified ? "This merchant is verified by the Mandate gateway." : "This merchant is not verified by the Mandate gateway."}
            </p>
          </div>
        </div>
      </article>

      {others.length > 0 && (
        <section className="mt-12" aria-label={`More from ${s.name}`}>
          <h2 className={`mb-4 text-xl text-ink ${t.heading}`}>More from {s.name}</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{others.map((x) => <ProductTile key={x.sku} store={s} product={x} />)}</div>
        </section>
      )}
    </>
  );
}
