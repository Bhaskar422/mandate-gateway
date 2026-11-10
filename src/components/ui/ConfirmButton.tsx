"use client";
import { useEffect, useRef, useState } from "react";
import Button from "./Button";

/**
 * A destructive action that asks once, in place. The first click turns the button into a question; the
 * question answers itself with "no" after a few seconds so a stray click never destroys anything.
 */
export default function ConfirmButton({ children, question, confirmLabel, onConfirm, loading = false, icon, size = "sm", variant = "danger" }: {
  children: React.ReactNode; question: string; confirmLabel: string; onConfirm: () => void; loading?: boolean; icon?: React.ReactNode; size?: "sm" | "md"; variant?: "danger" | "secondary" | "quiet";
}) {
  const [asking, setAsking] = useState(false);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!asking) return;
    yes.current?.focus();
    const t = setTimeout(() => setAsking(false), 8000);
    return () => clearTimeout(t);
  }, [asking]);

  if (loading) return <Button variant={variant} size={size} loading>{children}</Button>;
  if (!asking) return <Button variant={variant} size={size} icon={icon} onClick={() => setAsking(true)}>{children}</Button>;
  return (
    <span className="rise inline-flex flex-wrap items-center gap-2" role="group" aria-label={question}>
      <span className="text-sm font-medium text-ink">{question}</span>
      <button ref={yes} type="button" className={`btn btn-danger-solid ${size === "sm" ? "btn-sm" : ""}`} onClick={() => { setAsking(false); onConfirm(); }}>{confirmLabel}</button>
      <button type="button" className={`btn btn-quiet ${size === "sm" ? "btn-sm" : ""}`} onClick={() => setAsking(false)}>Cancel</button>
    </span>
  );
}
