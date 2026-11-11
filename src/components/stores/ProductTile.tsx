import Image from "next/image";
import Link from "next/link";
import { photoUrl, type Store, type StoreProduct } from "@/lib/stores/catalog";
import { money } from "../format";
import { storeTheme } from "./storeThemes";

/** One product in a shop's grid, in that shop's look. */
export default function ProductTile({ store, product: p }: { store: Store; product: StoreProduct }) {
  const t = storeTheme(store.slug);
  const loud = store.slug === "kickz";
  const off = p.wasCents ? Math.round((1 - p.priceCents / p.wasCents) * 100) : 0;
  return (
    <Link href={`/stores/${store.slug}/products/${p.sku}`}
      className={`group flex flex-col overflow-hidden bg-surface transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-card ${t.radius} ${loud ? "border-2 border-ink" : "border border-line"}`}>
      <div className="relative aspect-[4/3] overflow-hidden bg-sunken">
        <Image unoptimized src={photoUrl(p.photo, 800, 600)} alt={p.name} fill sizes="(min-width: 1024px) 340px, (min-width: 640px) 50vw, 100vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
        {p.badge && (
          <span className={`absolute left-3 top-3 px-2.5 py-1 text-xs font-bold ${loud ? "bg-[#facc15] uppercase italic text-black" : "rounded-full bg-surface/95 text-ink shadow-sm"}`}>{p.badge}</span>
        )}
        {off > 0 && <span className="num absolute right-0 top-3 bg-[var(--accent)] px-2 py-1 text-sm font-black text-white">-{off}%</span>}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent-ink)]">{p.category}</p>
        <h3 className={`mt-1 text-lg leading-snug text-ink ${t.heading}`}>{p.name}</h3>
        <p className="mt-1 text-sm text-ink-2">{p.blurb}</p>
        <p className="num mt-auto flex items-baseline gap-2 pt-3">
          <span className={`text-xl font-bold ${loud ? "text-[var(--accent)]" : "text-ink"}`}>{money(p.priceCents)}</span>
          {p.wasCents && <span className="text-sm text-ink-3 line-through">{money(p.wasCents)}</span>}
        </p>
      </div>
    </Link>
  );
}
