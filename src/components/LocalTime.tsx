"use client";
import { useEffect, useState } from "react";

type Format = "datetime" | "date" | "time" | "relative";

function relative(d: Date) {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (Math.abs(s) < 45) return "just now";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, "minute"], [3600, "hour"], [86400, "day"], [604800, "week"]];
  let unit: Intl.RelativeTimeFormatUnit = "minute", size = 60;
  for (const [n, u] of steps) if (Math.abs(s) >= n) { unit = u; size = n; }
  if (Math.abs(s) >= 30 * 86400) return d.toLocaleDateString(undefined, { dateStyle: "medium" });
  return rtf.format(-Math.round(s / size), unit);
}

function render(iso: string, format: Format) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (format === "relative") return relative(d);
  if (format === "date") return d.toLocaleDateString(undefined, { dateStyle: "medium" });
  if (format === "time") return d.toLocaleTimeString(undefined, { timeStyle: "short" });
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Dates are formatted in the browser only: the server's locale and time zone differ from the viewer's. */
export default function LocalTime({ iso, format = "datetime", className }: { iso: string; format?: Format; className?: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(render(iso, format));
    if (format !== "relative") return;
    const t = setInterval(() => setText(render(iso, format)), 30_000);
    return () => clearInterval(t);
  }, [iso, format]);
  return <time dateTime={iso} className={className} title={format === "relative" && text ? render(iso, "datetime") : undefined}>{text}</time>;
}
