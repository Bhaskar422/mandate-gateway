"use client";
import { useState } from "react";
import type { DashboardState } from "@/lib/views";
import { money, plural, shortDay } from "../format";

type Day = DashboardState["stats"]["byDay"][number];

const W = 560, H = 190, PAD_X = 6, MID = 112, TOP = 14, BOTTOM = H - 22;

/**
 * Fourteen days in one mirrored chart: money paid rises above the axis, blocked attempts hang below it.
 * The two halves have different units, so each has its own scale and label and they never share an axis.
 */
export default function ActivityChart({ days }: { days: Day[] }) {
  const [focus, setFocus] = useState<number | null>(null);
  const maxPaid = Math.max(...days.map((d) => d.paidCents), 1);
  const maxBlocked = Math.max(...days.map((d) => d.blockedCount), 1);
  const step = (W - PAD_X * 2) / days.length;
  const bar = Math.min(22, step * 0.58);
  const shown = focus === null ? null : days[focus];
  const totalPaid = days.reduce((s, d) => s + d.paidCents, 0), totalBlocked = days.reduce((s, d) => s + d.blockedCount, 0);
  const empty = totalPaid === 0 && totalBlocked === 0;

  return (
    <figure>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-ink-2">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-ok" aria-hidden />Paid</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-bad" aria-hidden />Blocked attempts</span>
        </div>
        <p className="num min-h-5 text-ink-2" aria-live="polite">
          {shown
            ? <><span className="font-semibold text-ink">{shortDay(shown.day)}</span>: {money(shown.paidCents)} paid in {plural(shown.paidCount, "purchase")}, {shown.blockedCount} blocked</>
            : <>{money(totalPaid)} paid, {totalBlocked} blocked in 14 days</>}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="img" aria-label={`Activity over the last 14 days: ${money(totalPaid)} paid and ${plural(totalBlocked, "blocked attempt")}.`} onMouseLeave={() => setFocus(null)}>
        <line x1={PAD_X} x2={W - PAD_X} y1={MID} y2={MID} stroke="var(--line-strong)" strokeWidth="1" />
        <text x={PAD_X} y={TOP - 3} fontSize="10" fill="var(--ink-3)">{money(maxPaid)}</text>
        <line x1={PAD_X} x2={W - PAD_X} y1={TOP} y2={TOP} stroke="var(--line)" strokeDasharray="2 4" />
        {days.map((d, i) => {
          const x = PAD_X + i * step + (step - bar) / 2;
          const up = (d.paidCents / maxPaid) * (MID - TOP - 2);
          const down = (d.blockedCount / maxBlocked) * (BOTTOM - MID - 14);
          const dim = focus !== null && focus !== i;
          return (
            <g key={d.day} opacity={dim ? 0.45 : 1} style={{ transition: "opacity .15s" }}>
              {d.paidCents > 0 && <rect x={x} y={MID - 1 - Math.max(up, 2)} width={bar} height={Math.max(up, 2)} rx="3" fill="var(--ok)" />}
              {d.blockedCount > 0 && <rect x={x} y={MID + 1} width={bar} height={Math.max(down, 2)} rx="3" fill="var(--bad)" />}
              {d.blockedCount > 0 && <text x={x + bar / 2} y={MID + 1 + Math.max(down, 2) + 11} fontSize="10" textAnchor="middle" fill="var(--ink-2)">{d.blockedCount}</text>}
              {(focus === i || (i % 2 === 1 && (focus === null || Math.abs(focus - i) > 1))) &&
                <text x={x + bar / 2} y={H - 4} fontSize="10" textAnchor="middle" fill={focus === i ? "var(--ink)" : "var(--ink-3)"} fontWeight={focus === i ? 600 : 400}>{shortDay(d.day)}</text>}
              {/* The hit target is the whole column, and is reachable by keyboard. */}
              <rect x={PAD_X + i * step} y={0} width={step} height={H} fill="transparent" tabIndex={0} role="button"
                aria-label={`${shortDay(d.day)}: ${money(d.paidCents)} paid in ${plural(d.paidCount, "purchase")}, ${plural(d.blockedCount, "blocked attempt")}`}
                onMouseEnter={() => setFocus(i)} onFocus={() => setFocus(i)} onBlur={() => setFocus(null)} style={{ outlineOffset: -2 }} />
            </g>
          );
        })}
      </svg>
      {empty && <figcaption className="mt-1 text-center text-sm text-ink-3">Nothing yet. Purchases and blocked attempts will appear here as your agents shop.</figcaption>}
    </figure>
  );
}
