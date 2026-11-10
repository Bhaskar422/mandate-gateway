import { money } from "../format";

/** A budget bar: how much of a limit is used. Turns amber near the limit and red at it. */
export default function Meter({ label, usedCents, limitCents, currency = "USD", usedWord = "committed" }: { label: string; usedCents: number; limitCents: number; currency?: string; usedWord?: string }) {
  const ratio = limitCents > 0 ? Math.min(1, Math.max(0, usedCents / limitCents)) : 0;
  const tone = ratio >= 1 ? "bad" : ratio >= 0.8 ? "warn" : "brand";
  const left = Math.max(0, limitCents - usedCents);
  const text = `${money(usedCents, currency)} ${usedWord} of ${money(limitCents, currency)}`;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium text-ink">{label}</span>
        <span className="num text-ink-2"><span className="font-semibold text-ink">{money(usedCents, currency)}</span> {usedWord} of {money(limitCents, currency)}</span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-sunken" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limitCents} aria-valuenow={Math.min(usedCents, limitCents)} aria-valuetext={text}>
        <div className={`tone-${tone} tone-fill h-2 rounded-full transition-[width] duration-500`} style={{ width: `${Math.max(ratio * 100, usedCents > 0 ? 2 : 0)}%` }} />
      </div>
      <p className="num mt-1 text-xs text-ink-3">{money(left, currency)} left</p>
    </div>
  );
}
