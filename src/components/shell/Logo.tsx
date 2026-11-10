/** The mark is a seal: the gateway's signature on everything an agent does. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" className="shrink-0">
      <circle cx="14" cy="14" r="13" fill="var(--brand)" />
      <circle cx="14" cy="14" r="10.2" fill="none" stroke="var(--on-brand)" strokeOpacity="0.45" strokeWidth="0.9" strokeDasharray="1.2 2" />
      <path d="M8.6 18.2V10l5.4 5.2L19.4 10v8.2" fill="none" stroke="var(--on-brand)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="display text-xl leading-none text-ink">Mandate</span>
    </span>
  );
}
