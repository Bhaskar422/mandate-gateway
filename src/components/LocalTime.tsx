"use client";
import { useEffect, useState } from "react";

/** Dates are formatted in the browser only: the server's locale and time zone differ from the viewer's. */
export default function LocalTime({ iso, timeOnly = false, className }: { iso: string; timeOnly?: boolean; className?: string }) {
  const [text, setText] = useState("");
  useEffect(() => { const d = new Date(iso); setText(timeOnly ? d.toLocaleTimeString() : d.toLocaleString()); }, [iso, timeOnly]);
  return <time dateTime={iso} className={className}>{text}</time>;
}
