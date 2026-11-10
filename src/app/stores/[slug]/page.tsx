import ProductTile from "@/components/stores/ProductTile";
import { storeTheme } from "@/components/stores/storeThemes";
import { getStore } from "@/lib/stores/catalog";

/** Contour lines for the trail shop's hero. Decorative. */
function Contours() {
  return (
    <svg viewBox="0 0 400 200" className="absolute inset-0 size-full opacity-25" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => <path key={i} d={`M-20 ${150 - i * 22} C 70 ${90 - i * 20}, 140 ${170 - i * 24}, 220 ${110 - i * 20} S 360 ${60 - i * 14}, 420 ${120 - i * 22}`} fill="none" stroke="#fff" strokeWidth="1.2" />)}
    </svg>
  );
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const s = getStore((await params).slug)!;
  const t = storeTheme(s.slug);
  return (
    <>
      <section className={`relative mb-8 bg-[var(--accent)] px-6 py-10 text-white sm:px-10 sm:py-14 ${t.radius}`} aria-label="Welcome">
        {s.slug === "peak" && <Contours />}
        <div className="relative max-w-xl">
          <h1 className={`text-3xl leading-tight sm:text-[2.6rem] sm:leading-[1.08] ${t.heading}`}>{t.heroTitle}</h1>
          <p className="mt-3 text-lg text-white/90">{t.heroBody}</p>
        </div>
      </section>
      <h2 className={`mb-4 text-xl text-ink ${t.heading}`}>{s.slug === "kickz" ? "Today's deals" : "Shop everything"}</h2>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {s.products.map((p) => <ProductTile key={p.sku} store={s} product={p} />)}
      </div>
    </>
  );
}
