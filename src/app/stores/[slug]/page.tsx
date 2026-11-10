import Link from "next/link";
import { money } from "@/lib/ids";
import { getStore } from "@/lib/stores/catalog";

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const s = getStore((await params).slug)!;
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {s.products.map((p) => (
        <Link key={p.sku} href={`/stores/${s.slug}/products/${p.sku}`} className="card p-5 transition hover:shadow-md">
          <div className="mb-3 flex h-28 items-center justify-center rounded-lg bg-slate-50 text-6xl">{p.image}</div>
          <p className="text-xs text-slate-500">{p.category}</p>
          <h2 className="font-semibold">{p.name}</h2>
          <p className="mt-1 font-bold">{money(p.priceCents)}</p>
        </Link>
      ))}
    </div>
  );
}
