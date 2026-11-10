/** The title block at the top of every dashboard page. */
export function PageHeader({ title, lead, actions }: { title: string; lead?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-2xl">
        <h1 className="display text-2xl text-ink sm:text-3xl">{title}</h1>
        {lead && <p className="mt-1.5 text-base text-ink-2">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, hint, actions, children, className = "", id }: { title: string; hint?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section className={className} id={id} aria-label={title}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {hint && <p className="text-sm text-ink-3">{hint}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-dashed border-line-strong px-5 py-9 text-center">
      {icon && <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-sunken text-ink-3">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-ink-3">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Label and value, for the small fact lists on cards. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 text-base text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
