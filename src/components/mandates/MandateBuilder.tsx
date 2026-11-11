"use client";
import { useEffect, useState } from "react";

const KINDS = ["running shoes", "coffee beans and brewing gear", "houseplants", "books", "groceries"];
const DAYS = [3, 7, 14, 30];

/** The sentence a mandate is compiled from, assembled from a few choices. The user can still edit it afterwards. */
export function sentence(b: { budget: number; kinds: string[]; other: string; stores: "verified" | "named" | "any"; named: string; ask: "never" | "above" | "always"; askAbove: number; days: number; never: string }) {
  const what = [...b.kinds, ...b.other.split(",").map((x) => x.trim()).filter(Boolean)];
  const list = what.length > 1 ? `${what.slice(0, -1).join(", ")} and ${what[what.length - 1]}` : what[0] ?? "";
  const where = b.stores === "any" ? "from any store" : b.stores === "named" && b.named.trim() ? `only from ${b.named.trim()}` : "from verified stores only";
  const parts = [`Up to $${b.budget} in total${list ? ` on ${list}` : ""}, ${where}.`];
  if (b.ask === "always") parts.push("Ask me before every purchase.");
  if (b.ask === "above") parts.push(`Ask me before anything over $${Math.min(b.askAbove, b.budget)}.`);
  if (b.never.trim()) parts.push(`Never buy from ${b.never.trim()}.`);
  parts.push(`Valid for ${b.days} days.`);
  return parts.join(" ");
}

/** A mandate without writing: pick a budget, what, where and when to be asked. */
export default function MandateBuilder({ onChange, disabled }: { onChange: (text: string) => void; disabled?: boolean }) {
  const [b, setB] = useState({ budget: 100, kinds: ["running shoes"] as string[], other: "", stores: "verified" as "verified" | "named" | "any", named: "", ask: "above" as "never" | "above" | "always", askAbove: 60, days: 7, never: "" });
  const set = <K extends keyof typeof b>(k: K, v: (typeof b)[K]) => setB((x) => ({ ...x, [k]: v }));
  const text = sentence(b);
  useEffect(() => { onChange(text); }, [text, onChange]);
  const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${on ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:border-line-strong hover:text-ink"}`;
  const noKind = !b.kinds.length && !b.other.trim();

  return (
    <fieldset disabled={disabled} className="space-y-6">
      <div>
        <label htmlFor="b-budget" className="flex items-baseline justify-between"><span className="field-label !mb-0">How much may the agent spend in total?</span><span className="display num text-2xl text-ink">${b.budget}</span></label>
        <input id="b-budget" type="range" min={10} max={500} step={10} value={b.budget} onChange={(e) => set("budget", Number(e.target.value))} className="mt-2 w-full" aria-valuetext={`${b.budget} dollars`} />
        <p className="field-hint">This is the most that can leave your PayPal account under this mandate, across all purchases.</p>
      </div>

      <div>
        <p className="field-label">What may it buy?</p>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => { const on = b.kinds.includes(k); return <button key={k} type="button" aria-pressed={on} className={chip(on)} onClick={() => set("kinds", on ? b.kinds.filter((x) => x !== k) : [...b.kinds, k])}>{k}</button>; })}
        </div>
        <label htmlFor="b-other" className="sr-only">Something else</label>
        <input id="b-other" className="field mt-2 max-w-md" value={b.other} onChange={(e) => set("other", e.target.value)} maxLength={80} placeholder="Something else, for example: phone cases" />
        {noKind && <p className="mt-1 text-xs text-warn-ink">Pick at least one kind of product, or type one.</p>}
      </div>

      <div>
        <p className="field-label">Which stores?</p>
        <div className="space-y-1">
          <label className="flex items-start gap-2.5 py-1 text-base"><input type="radio" name="b-stores" className="mt-1" checked={b.stores === "verified"} onChange={() => set("stores", "verified")} /><span><span className="font-medium text-ink">Verified stores only</span><span className="block text-sm text-ink-3">Stores the gateway&apos;s operator has reviewed. The safest choice.</span></span></label>
          <label className="flex items-start gap-2.5 py-1 text-base"><input type="radio" name="b-stores" className="mt-1" checked={b.stores === "named"} onChange={() => set("stores", "named")} /><span><span className="font-medium text-ink">Only stores I name</span></span></label>
          {b.stores === "named" && <input aria-label="Store names" className="field ml-6 max-w-md" value={b.named} onChange={(e) => set("named", e.target.value)} maxLength={120} placeholder="Stride Running Co." />}
          <label className="flex items-start gap-2.5 py-1 text-base"><input type="radio" name="b-stores" className="mt-1" checked={b.stores === "any"} onChange={() => set("stores", "any")} /><span><span className="font-medium text-ink">Any store the gateway can pay</span><span className="block text-sm text-ink-3">Includes stores that have proved they own their website but have not been reviewed.</span></span></label>
        </div>
      </div>

      <div>
        <p className="field-label">When should it ask you first?</p>
        <div className="space-y-1">
          <label className="flex items-start gap-2.5 py-1 text-base"><input type="radio" name="b-ask" className="mt-1" checked={b.ask === "above"} onChange={() => set("ask", "above")} /><span className="font-medium text-ink">Above an amount</span></label>
          {b.ask === "above" && (
            <div className="ml-6 max-w-md">
              <label htmlFor="b-ask" className="flex items-baseline justify-between text-sm text-ink-2"><span>Ask me before anything over</span><span className="display num text-xl text-ink">${Math.min(b.askAbove, b.budget)}</span></label>
              <input id="b-ask" type="range" min={0} max={b.budget} step={5} value={Math.min(b.askAbove, b.budget)} onChange={(e) => set("askAbove", Number(e.target.value))} className="mt-1 w-full" />
            </div>
          )}
          <label className="flex items-start gap-2.5 py-1 text-base"><input type="radio" name="b-ask" className="mt-1" checked={b.ask === "always"} onChange={() => set("ask", "always")} /><span className="font-medium text-ink">Before every purchase</span></label>
          <label className="flex items-start gap-2.5 py-1 text-base"><input type="radio" name="b-ask" className="mt-1" checked={b.ask === "never"} onChange={() => set("ask", "never")} /><span><span className="font-medium text-ink">Never</span><span className="block text-sm text-ink-3">Anything inside the limits is paid without asking.</span></span></label>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <p className="field-label">How long does it last?</p>
          <div className="flex flex-wrap gap-1.5">{DAYS.map((d) => <button key={d} type="button" aria-pressed={b.days === d} className={chip(b.days === d)} onClick={() => set("days", d)}>{d} days</button>)}</div>
        </div>
        <div>
          <label htmlFor="b-never" className="field-label">A store it must never buy from <span className="font-normal text-ink-3">(optional)</span></label>
          <input id="b-never" className="field" value={b.never} onChange={(e) => set("never", e.target.value)} maxLength={80} placeholder="Kickz Outlet" />
        </div>
      </div>
    </fieldset>
  );
}
