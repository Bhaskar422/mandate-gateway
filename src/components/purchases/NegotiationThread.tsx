import { Bot, Store, User } from "lucide-react";
import type { PurchaseView } from "@/lib/views";
import LocalTime from "../LocalTime";

type Turn = NonNullable<PurchaseView["case"]>["transcript"][number];
const ACTION: Record<Turn["action"], string> = { ask: "Asked", offer: "Offered", counter: "Countered", accept: "Accepted", decline: "Declined", refund: "Refunded" };

/** The settlement, as the conversation it was: your agent on the right, the store's agent on the left. */
export default function NegotiationThread({ transcript, merchant }: { transcript: Turn[]; merchant: string | null }) {
  if (!transcript.length) return <p className="text-sm text-ink-3">The store has not answered yet.</p>;
  return (
    <ol className="space-y-3">
      {transcript.map((t, i) => {
        const mine = t.by !== "merchant_agent";
        const who = t.by === "user" ? "You" : t.by === "buyer_agent" ? "Your agent" : `${merchant ?? "The store"}'s agent`;
        const Icon = t.by === "user" ? User : t.by === "buyer_agent" ? Bot : Store;
        return (
          <li key={i} className={`flex gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
            <span className={`mt-5 flex size-7 shrink-0 items-center justify-center rounded-full ${t.by === "user" ? "bg-ink text-bg" : mine ? "bg-brand-soft text-brand-ink" : "bg-sunken text-ink-2"}`}><Icon size={14} aria-hidden /></span>
            <div className={`min-w-0 max-w-[85%] ${mine ? "text-right" : ""}`}>
              <p className="text-xs text-ink-3"><span className="font-semibold text-ink-2">{who}</span> · {ACTION[t.action]} · <LocalTime iso={t.at} format="time" /></p>
              <p className={`mt-1 inline-block rounded-2xl px-3.5 py-2 text-left text-base [overflow-wrap:anywhere] ${mine ? "rounded-tr-sm bg-brand-soft text-ink" : "rounded-tl-sm border border-line bg-raised text-ink"}`}>{t.note}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
