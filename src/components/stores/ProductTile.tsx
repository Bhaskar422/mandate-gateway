import Link from "next/link";
import type { Store, StoreProduct } from "@/lib/stores/catalog";
import { money } from "../format";
import { storeTheme } from "./storeThemes";

/** One product in a shop's grid, in that shop's look. */
export default function ProductTile({ store, product: p }: { store: Store; product: StoreProduct }) {
  const t = storeTheme(store.slug);
  const loud = store.slug === "kickz";
  return (
    <Link href={`/stores/${store.slug}/products/${p.sku}`} className={`group block border bg-surface transition-shadow hover:shadow-card ${t.radius} ${loud ? "border-2 border-ink" : "border-line"}`}>
      <div className={`flex h-40 items-center justify-center bg-[var(--accent-soft)] text-7xl transition-transform ${loud ? "" : t.radius === "rounded-2xl" ? "rounded-t-2xl" : "rounded-t-lg"}`}><span aria-hidden>{p.image}</span></div>
      <div className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{p.category}</p>
        <h3 className={`mt-0.5 text-lg leading-snug text-ink group-hover:underline ${t.heading}`}>{p.name}</h3>
        <p className="num mt-2 text-lg font-bold text-ink">
          {money(p.priceCents)}
          {loud && <span className="ml-2 text-sm font-medium text-ink-3 line-through">{money(p.priceCents * 5)}</span>}
        </p>
      </div>
    </Link>
  );
}
