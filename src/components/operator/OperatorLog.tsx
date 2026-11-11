import type { OperatorEvent } from "@/lib/operator-log";
import LocalTime from "../LocalTime";

/** Every change to who can be paid, newest first, each one a signed ledger entry. */
export default function OperatorLog({ events }: { events: OperatorEvent[] }) {
  return (
    <section aria-labelledby="oplog-h" className="mt-10">
      <h2 id="oplog-h" className="display text-xl text-ink sm:text-2xl">Review history</h2>
      <p className="mt-1 text-base text-ink-2">Every decision made here, and every time a store changed where it is paid, is written to the same signed ledger as purchases.</p>
      {events.length === 0 ? <p className="mt-4 text-base text-ink-3">Nothing has been reviewed yet.</p> : (
        <ol className="mt-4 divide-y divide-line rounded-[10px] border border-line">
          {events.map((e) => (
            <li key={e.seq} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3">
              <div className="min-w-0">
                <p className="text-ink"><span className={`tone-${e.tone} tone-text font-semibold`}>{e.what}</span> · <span className="[overflow-wrap:anywhere]">{e.store}</span></p>
                {e.detail && <p className="text-sm text-ink-2">{e.detail}</p>}
              </div>
              <p className="num shrink-0 text-sm text-ink-3"><LocalTime iso={e.at} /> · entry #{e.seq}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
