"use client";
import { Bot, Code2, FileCheck2, FlaskConical, LayoutDashboard, Menu, ReceiptText, ScrollText, Settings, ShoppingBag, Store, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount } from "../AccountProvider";
import Banner from "../ui/Banner";
import { FrozenBanner, KillSwitch } from "./KillSwitch";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

type Item = { href: string; label: string; icon: React.ReactNode; badge?: number };
const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`) || (href === "/activity" && path.startsWith("/purchases")));

function NavLink({ item, path, onNavigate }: { item: Item; path: string; onNavigate?: () => void }) {
  const active = isActive(path, item.href);
  return (
    <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-base font-medium transition-colors ${active ? "bg-brand-soft text-brand-ink" : "text-ink-2 hover:bg-sunken hover:text-ink"}`}>
      {item.icon}<span className="flex-1">{item.label}</span>
      {!!item.badge && <span className="tone-warn tone-softbg tone-text num rounded-full px-1.5 text-xs font-bold" aria-label={`${item.badge} waiting for you`}>{item.badge}</span>}
    </Link>
  );
}

/** The frame around every signed-in page: navigation, the kill switch and account-wide banners. */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { state } = useAccount();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const waiting = state.stats.pendingCount + state.stats.offersWaiting;
  const main: Item[] = [
    { href: "/", label: "Overview", icon: <LayoutDashboard size={17} aria-hidden /> },
    { href: "/activity", label: "Activity", icon: <ReceiptText size={17} aria-hidden />, badge: waiting },
    { href: "/mandates", label: "Mandates", icon: <ScrollText size={17} aria-hidden /> },
    { href: "/agents", label: "Agents", icon: <Bot size={17} aria-hidden /> },
    { href: "/merchants", label: "Merchants", icon: <Store size={17} aria-hidden /> },
    { href: "/settings", label: "Settings", icon: <Settings size={17} aria-hidden /> },
  ];
  const more: Item[] = [
    { href: "/verify", label: "Verify a record", icon: <FileCheck2 size={17} aria-hidden /> },
    { href: "/developers", label: "Developers", icon: <Code2 size={17} aria-hidden /> },
    { href: "/stores/stride", label: "Demo stores", icon: <ShoppingBag size={17} aria-hidden /> },
  ];

  const paypal = (
    <Link href="/settings" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-sunken">
      <span className={`inline-block size-2 shrink-0 rounded-full ${state.paypal ? "bg-ok" : "bg-warn"}`} aria-hidden />
      <span className="min-w-0 truncate">{state.paypal ? `PayPal: ${state.paypal.email ?? "linked"}` : "PayPal not linked"}</span>
    </Link>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <a href="#main" className="btn btn-primary sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50">Skip to content</a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
        <Link href="/" className="px-5 pb-4 pt-5" aria-label="Mandate, overview"><Logo /></Link>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3">
          <ul className="space-y-0.5">{main.map((i) => <li key={i.href}><NavLink item={i} path={path} /></li>)}</ul>
          <p className="eyebrow mb-1 mt-6 px-3">Resources</p>
          <ul className="space-y-0.5">{more.map((i) => <li key={i.href}><NavLink item={i} path={path} /></li>)}</ul>
        </nav>
        <div className="space-y-2 border-t border-line p-3">
          <KillSwitch layout="sidebar" />
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">{paypal}</div>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <Link href="/" aria-label="Mandate, overview"><Logo size={24} /></Link>
          <KillSwitch layout="compact" />
        </header>

        <main id="main" className="mx-auto w-full max-w-[1120px] flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-16 lg:pt-9">
          <div className="mb-5 space-y-3 empty:hidden">
            <FrozenBanner />
            {state.simulated && (
              <Banner tone="neutral" icon={<FlaskConical size={17} aria-hidden />} title="Simulated payments">
                This gateway has no PayPal credentials, so payments, refunds and disputes are simulated. No money moves.
              </Banner>
            )}
          </div>
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <ul className="grid grid-cols-5">
          {main.slice(0, 4).map((i) => {
            const active = isActive(path, i.href);
            return (
              <li key={i.href}>
                <Link href={i.href} aria-current={active ? "page" : undefined} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? "text-brand-ink" : "text-ink-2"}`}>
                  {i.icon}{i.label}
                  {!!i.badge && <span className="num absolute right-[22%] top-1 min-w-4 rounded-full bg-warn-ink px-1 text-center text-[10px] font-bold leading-4 text-surface" aria-label={`${i.badge} waiting for you`}>{i.badge}</span>}
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={`flex w-full flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${[...main.slice(4), ...more].some((i) => isActive(path, i.href)) ? "text-brand-ink" : "text-ink-2"}`}>
              <Menu size={17} aria-hidden />More
            </button>
          </li>
        </ul>
      </nav>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="More pages">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="rise absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="mb-2 flex items-center justify-between">
              <p className="eyebrow">More</p>
              <button type="button" className="btn btn-quiet btn-sm !px-2" onClick={() => setOpen(false)} aria-label="Close menu" autoFocus><X size={16} aria-hidden /></button>
            </div>
            <ul className="space-y-0.5">{[...main.slice(4), ...more].map((i) => <li key={i.href}><NavLink item={i} path={path} onNavigate={() => setOpen(false)} /></li>)}</ul>
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
              <div className="min-w-0 flex-1">{paypal}</div>
              <ThemeToggle withLabel />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
