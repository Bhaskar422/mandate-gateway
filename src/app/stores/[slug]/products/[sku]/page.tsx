import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, Check, ChevronRight, CircleAlert, PackageCheck } from "lucide-react";
import { money } from "@/components/format";
import ProductTile from "@/components/stores/ProductTile";
import { storeTheme } from "@/components/stores/storeThemes";
import { CopyButton } from "@/components/ui/Copy";
import { appUrl } from "@/lib/config";
import { getProduct, getStore, photoUrl } from "@/lib/stores/catalog";

export default async function ProductPage({ params }: { params: Promise<{ slug: string; sku: string }> }) {
  const { slug, sku } = await params;
  const s = getStore(slug), p = getProduct(slug, sku);
  if (!s || !p) notFound();
  const t = storeTheme(slug);
  const url = `${appUrl()}/stores/${slug}/products/${sku}`;
  // The gateway reads this block to learn the product's name, SKU, category and price. Keep it as it is.
  const ld = { "@context": "https://schema.org", "@type": "Product", name: p.name, sku: p.sku, category: p.category, description: p.description, image: photoUrl(p.photo, 1200, 900),
    brand: { "@type": "Brand", name: s.name },
    offers: { "@type": "Offer", price: (p.priceCents / 100).toFixed(2), priceCurrency: "USD", availability: "https://schema.org/InStock", url } };
  const others = s.products.filter((x) => x.sku !== p.sku).slice(0, 3);
  const loud = slug === "kickz";
  const off = p.wasCents ? Math.round((1 - p.priceCents / p.wasCents) * 100) : 0;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-1 text-sm text-ink-3">
        <Link href={`/stores/${slug}`} className="hover:text-ink">{s.name}</Link><ChevronRight size={13} aria-hidden /><span>{p.category}</span>
      </nav>
      <article className="grid gap-8 md:grid-cols-2 md:gap-12">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
        <div className={`relative aspect-[4/3] self-start overflow-hidden bg-sunken ${t.radius} ${loud ? "border-2 border-ink" : ""}`}>
          <Image unoptimized src={photoUrl(p.photo, 1200, 900)} alt={p.name} fill priority sizes="(min-width: 768px) 540px, 100vw" className="object-cover" />
          {p.badge && <span className={`absolute left-4 top-4 px-3 py-1 text-sm font-bold ${loud ? "bg-[#facc15] uppercase italic text-black" : "rounded-full bg-surface/95 text-ink shadow-sm"}`}>{p.badge}</span>}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent-ink)]">{p.category} · SKU {p.sku}</p>
          <h1 className={`mt-2 text-[2rem] leading-[1.1] text-ink sm:text-[2.4rem] ${t.heading}`}>{p.name}</h1>
          <p className="num mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`text-3xl font-bold ${loud ? "text-[var(--accent)]" : "text-ink"}`}>{money(p.priceCents)}</span>
            {p.wasCents && <span className="text-lg text-ink-3 line-through">{money(p.wasCents)}</span>}
            {off > 0 && <span className="bg-[var(--accent)] px-2 py-0.5 text-sm font-black text-white">-{off}%</span>}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-2"><PackageCheck size={15} className="shrink-0 text-ok" aria-hidden />In stock · {t.shipping}</p>
          <p className="mt-5 text-lg text-ink-2">{p.description}</p>
          <ul className="mt-4 space-y-1.5">
            {p.features.map((f) => <li key={f} className="flex items-start gap-2 text-base text-ink"><Check size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" aria-hidden />{f}</li>)}
          </ul>
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
