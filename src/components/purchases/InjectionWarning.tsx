import { ShieldAlert } from "lucide-react";
import type { PurchaseView } from "@/lib/views";

type Signal = PurchaseView["signals"][number];

/** What the gateway found on the store's page that was written for AI agents rather than shoppers. */
export default function InjectionWarning({ signals, compact = false }: { signals: Signal[]; compact?: boolean }) {
  const aimed = signals.filter((s) => s.kind === "agent_directed_text");
  if (!aimed.length) return null;
  const hidden = signals.some((s) => s.kind === "hidden_text");
  return (
    <div className="tone-flag rounded-[10px] border border-[color-mix(in_srgb,var(--flag)_35%,transparent)] bg-flag-soft p-4 text-flag-ink">
      <p className="flex items-center gap-2 font-semibold"><ShieldAlert size={18} className="tone-mark shrink-0" aria-hidden />Possible prompt injection on the store&apos;s page</p>
      <p className="mt-1.5 text-sm">
        The page the gateway fetched contains text that {aimed[0].detail}{hidden ? ", hidden from human shoppers" : ""}. Text like this is written to steer an AI agent into buying something else.
        {!compact && " The gateway does not follow page text: your limits are enforced by code, so the most this could do was send the purchase to you."}
      </p>
      {aimed.map((s, i) => (
        <figure key={i} className="mt-3">
          <figcaption className="eyebrow !text-flag-ink">What the page said</figcaption>
          <blockquote className="code mt-1 rounded-lg border border-[color-mix(in_srgb,var(--flag)_25%,transparent)] bg-surface p-3 text-ink [overflow-wrap:anywhere]">…{s.excerpt}…</blockquote>
        </figure>
      ))}
    </div>
  );
}
