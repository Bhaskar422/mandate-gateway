import type { Tone } from "../format";

export default function Banner({ tone = "neutral", icon, title, children, action, className = "", role }: {
  tone?: Tone; icon?: React.ReactNode; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string; role?: "alert" | "status";
}) {
  return (
    <div className={`banner tone-${tone} ${className}`} role={role}>
      {icon && <span className="tone-mark mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="[overflow-wrap:anywhere]">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/** The error text a server action returned. */
export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="tone-bad tone-text rise text-sm font-medium [overflow-wrap:anywhere]">{children}</p>;
}
