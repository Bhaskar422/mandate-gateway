"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked: the text is selectable */ }
  };
  return (
    <button type="button" onClick={copy} className={`btn btn-secondary btn-sm ${className}`}>
      {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}<span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}

/** A snippet with its own copy button. `wrap` breaks long lines instead of scrolling sideways. */
export function CodeBlock({ code, label, wrap = false }: { code: string; label?: string; wrap?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="eyebrow">{label}</span>
        <CopyButton text={code} />
      </div>
      <pre className={`codeblock ${wrap ? "wrap" : ""}`} tabIndex={0}>{code}</pre>
    </div>
  );
}
