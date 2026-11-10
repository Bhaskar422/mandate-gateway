import { caseStatus, purchaseStatus, type Tone } from "../format";

export function Badge({ tone = "neutral", icon, children, className = "" }: { tone?: Tone; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <span className={`badge tone-${tone} ${className}`}>{icon}{children}</span>;
}

/** A dot plus a label: status is never carried by colour alone. */
export function StatusBadge({ status, kind = "purchase" }: { status: string; kind?: "purchase" | "case" }) {
  const s = kind === "case" ? caseStatus(status) : purchaseStatus(status);
  return <Badge tone={s.tone} icon={<span className="tone-fill inline-block size-1.5 rounded-full" aria-hidden />}>{s.label}</Badge>;
}
