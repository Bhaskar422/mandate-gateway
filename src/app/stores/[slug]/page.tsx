import Image from "next/image";
import ProductTile from "@/components/stores/ProductTile";
import { storeTheme, type StoreTheme } from "@/components/stores/storeThemes";
import { getStore, photoUrl, type Store } from "@/lib/stores/catalog";

/** Stride: a clean split, words on the left and the shoe on the right. */
function SplitHero({ t }: { t: StoreTheme }) {
  return (
    <section aria-label="Welcome" className="grid overflow-hidden rounded-3xl bg-[var(--accent-soft)] md:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-10 sm:px-10 sm:py-14">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent-ink)]">{t.heroEyebrow}</p>
        <h1 className={`mt-3 text-[2.5rem] leading-[1.04] text-ink sm:text-[3.4rem] ${t.heading}`}>{t.heroTitle}</h1>
        <p className="mt-4 max-w-md text-lg text-ink-2">{t.heroBody}</p>
        <a href="#shop" className="mt-7 inline-flex w-fit items-center rounded-full bg-[var(--accent)] px-6 py-3 text-base font-semibold text-white transition-opacity hover:opacity-90">Shop the range</a>
      </div>
      <div className="relative min-h-64 md:min-h-[26rem]">
        <Image unoptimized src={photoUrl(t.heroPhoto, 1200, 900)} alt="A runner's feet mid-stride on a track" fill priority sizes="(min-width: 768px) 520px, 100vw" className="object-cover" />
      </div>
    </section>
  );
}

/** Kickz: black, loud and slanted. */
function LoudHero({ t }: { t: StoreTheme }) {
  return (
    <section aria-label="Welcome" className="relative overflow-hidden bg-black text-white">
      <Image unoptimized src={photoUrl(t.heroPhoto, 1600, 800)} alt="" fill priority sizes="100vw" className="object-cover opacity-55" />
      <div className="relative px-6 py-12 sm:px-10 sm:py-16">
        <p className="inline-block -skew-x-6 bg-[#facc15] px-3 py-1 text-sm font-black uppercase italic text-black">{t.heroEyebrow}</p>
        <h1 className={`mt-4 max-w-2xl text-[2.6rem] leading-[0.98] sm:text-[4.2rem] ${t.heading}`}>{t.heroTitle}</h1>
        <p className="mt-4 max-w-md text-lg font-medium text-white/90">{t.heroBody}</p>
        <a href="#shop" className="mt-7 inline-flex items-center bg-[var(--accent)] px-7 py-3 text-base font-black uppercase italic text-white transition-transform hover:scale-[1.03]">Grab a deal</a>
      </div>
    </section>
  );
}

/** Peak: one wide photograph of the trail, with the words set over it. */
function PhotoHero({ t }: { t: StoreTheme }) {
  return (
    <section aria-label="Welcome" className="relative overflow-hidden rounded-lg text-white">
      <Image unoptimized src={photoUrl(t.heroPhoto, 1600, 800)} alt="A runner with a headlamp on a mountain ridge at dusk" fill priority sizes="100vw" className="object-cover object-[50%_22%]" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/10" />
      <div className="relative flex min-h-[22rem] flex-col justify-end px-6 py-8 sm:min-h-[28rem] sm:px-10 sm:py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/85">{t.heroEyebrow}</p>
        <h1 className={`mt-2 max-w-2xl text-[2.4rem] leading-[1.06] sm:text-[3.4rem] ${t.heading}`}>{t.heroTitle}</h1>
        <p className="mt-3 max-w-lg text-lg text-white/90">{t.heroBody}</p>
      </div>
    </section>
  );
}

function Perks({ s, t }: { s: Store; t: StoreTheme }) {
  const loud = s.slug === "kickz";
  return (
    <ul className={`mt-5 grid gap-px overflow-hidden sm:grid-cols-3 ${loud ? "bg-ink" : `border border-line bg-line ${t.radius}`}`}>
      {t.perks.map((p) => (
        <li key={p.title} className={`px-5 py-4 ${loud ? "bg-[#facc15] text-black" : "bg-surface"}`}>
          <p className={`text-base ${loud ? "font-black uppercase italic" : "font-semibold text-ink"}`}>{p.title}</p>
          <p className={`text-sm ${loud ? "font-medium text-black/75" : "text-ink-2"}`}>{p.body}</p>
        </li>
      ))}
    </ul>
  );
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const s = getStore((await params).slug)!;
  const t = storeTheme(s.slug);
  return (
    <>
      {s.slug === "kickz" ? <LoudHero t={t} /> : s.slug === "peak" ? <PhotoHero t={t} /> : <SplitHero t={t} />}
      <Perks s={s} t={t} />

      <section id="shop" aria-labelledby="shop-title" className="mt-12 scroll-mt-6">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="shop-title" className={`text-2xl text-ink ${t.heading}`}>{t.gridTitle}</h2>
          <p className="text-sm text-ink-3">{s.products.length} products</p>
        </div>
        <div className={`grid gap-5 sm:grid-cols-2 ${s.products.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
          {s.products.map((p) => <ProductTile key={p.sku} store={s} product={p} />)}
        </div>
      </section>

      <section aria-label={t.closing.title} className={`mt-12 px-6 py-8 sm:px-10 ${s.slug === "kickz" ? "bg-black text-white" : `bg-[var(--accent-soft)] ${t.radius}`}`}>
        <h2 className={`text-2xl ${t.heading} ${s.slug === "kickz" ? "" : "text-ink"}`}>{t.closing.title}</h2>
        <p className={`mt-2 max-w-2xl text-base ${s.slug === "kickz" ? "text-white/80" : "text-ink-2"}`}>{t.closing.body}</p>
      </section>
    </>
  );
}
