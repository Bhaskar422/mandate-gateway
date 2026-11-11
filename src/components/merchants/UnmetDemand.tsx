import type { UnmetStore } from "@/lib/channel3";
import { money } from "../format";

/** Stores where shoppers' agents found a product and could not buy it, because the store has not joined. */
export default function UnmetDemand({ stores, days }: { stores: UnmetStore[]; days: number }) {
  if (!stores.length) return null;
  const total = stores.reduce((n, s) => n + s.requests, 0);
  return (
    <section aria-labelledby="unmet-h" className="mt-10">
      <p className="eyebrow">Demand that had nowhere to go</p>
      <h2 id="unmet-h" className="display mt-1 text-xl text-ink sm:text-2xl">Where agents looked and could not buy</h2>
      <p className="mt-2 max-w-3xl text-base text-ink-2">
        When no joined store has what a shopper asked for, the assistant looks across the wider web. In the last {days} days it found {total} {total === 1 ? "product" : "products"} at
        stores that have not joined, so it could only tell the shopper where to look. If one of these is yours, registering above is what turns those into paid orders.
      </p>
      <ul className="mt-4 divide-y divide-line rounded-[10px] border border-line">
        {stores.map((s) => (
          <li key={s.domain} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3">
            <div className="min-w-0">
              <p className="code font-semibold text-ink [overflow-wrap:anywhere]">{s.domain}</p>
              <p className="text-sm text-ink-3 [overflow-wrap:anywhere]">For example: {s.example}</p>
            </div>
            <p className="num shrink-0 text-sm text-ink-2">{s.requests} {s.requests === 1 ? "product found" : "products found"}{s.valueCents > 0 ? ` · ${money(s.valueCents, "USD")} in list prices` : ""}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-ink-3">Counts hold the store and the product only: no shopper, and none of what they typed. Product search across stores that have not joined is by Channel3.</p>
    </section>
  );
}
