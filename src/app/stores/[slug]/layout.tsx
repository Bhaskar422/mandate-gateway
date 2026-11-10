import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck } from "lucide-react";
import { LogoMark } from "@/components/shell/Logo";
import ThemeToggle from "@/components/shell/ThemeToggle";
import { storeTheme } from "@/components/stores/storeThemes";
import { getStore, STORES } from "@/lib/stores/catalog";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const s = getStore((await params).slug);
  return s ? { title: { absolute: `${s.name} · ${s.tagline}` } } : {};
}

/** A demo storefront. The thin bar on top belongs to Mandate; everything under it is the shop's own look. */
export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const s = getStore((await params).slug);
  if (!s) notFound();
  const t = storeTheme(s.slug);
  const solid = t.header === "solid";
  const vars = { "--accent": s.accent, "--accent-ink": "color-mix(in srgb, var(--accent) 62%, var(--ink))", "--accent-soft": "color-mix(in srgb, var(--accent) 12%, var(--surface))" } as React.CSSProperties;

  return (
    <div className="flex min-h-dvh flex-col bg-surface" style={vars}>
      <div className="border-b border-line bg-bg">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1.5 text-xs text-ink-2 sm:px-6">
          <Link href="/" className="inline-flex items-center gap-1.5 font-medium hover:text-ink"><ArrowLeft size={12} aria-hidden /><LogoMark size={16} />Mandate dashboard</Link>
          <nav aria-label="Demo stores" className="flex items-center gap-1">
            <span className="mr-1 max-sm:sr-only">Demo stores:</span>
            {STORES.map((x) => <Link key={x.slug} href={`/stores/${x.slug}`} aria-current={x.slug === s.slug ? "page" : undefined} className={`rounded px-1.5 py-0.5 ${x.slug === s.slug ? "bg-sunken font-semibold text-ink" : "hover:text-ink"}`}>{x.name.split(" ")[0]}</Link>)}
            <ThemeToggle />
          </nav>
        </div>
      </div>

      {t.promo && <p className="bg-ink px-4 py-1.5 text-center text-xs font-bold tracking-wide text-bg">{t.promo}</p>}
      <header className={solid ? "bg-[var(--accent)] text-white" : "border-b border-line"}>
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 sm:px-6">
          <Link href={`/stores/${s.slug}`} className="min-w-0">
            <span className={`block text-2xl leading-tight ${t.heading} ${solid ? "" : "text-[var(--accent-ink)]"}`}>{s.name}</span>
            <span className={`block text-sm ${solid ? "text-white/85" : "text-ink-3"}`}>{s.tagline}</span>
          </Link>
          <nav aria-label="Store" className="flex items-center gap-1 text-sm font-semibold">
            {s.verified && <span className={`mr-2 inline-flex items-center gap-1 text-xs font-semibold ${solid ? "text-white" : "text-ok-ink"}`}><BadgeCheck size={14} aria-hidden />Verified by Mandate</span>}
            <Link href={`/stores/${s.slug}`} className={`rounded-md px-3 py-1.5 ${solid ? "hover:bg-white/15" : "text-ink-2 hover:bg-sunken hover:text-ink"}`}>Shop</Link>
            <Link href={`/stores/${s.slug}/admin`} className={`rounded-md px-3 py-1.5 ${solid ? "hover:bg-white/15" : "text-ink-2 hover:bg-sunken hover:text-ink"}`}>Back office</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1080px] flex-1 px-4 py-8 sm:px-6">{children}</main>

      <footer className="border-t border-line bg-bg">
        <div className="mx-auto flex max-w-[1080px] flex-wrap justify-between gap-x-8 gap-y-2 px-4 py-5 text-xs text-ink-3 sm:px-6">
          <p>{s.name} is a demo shop for the Mandate gateway. Nothing here is really for sale.</p>
          <p>Catalogue for shopping agents (MCP): <span className="code text-ink-2">/stores/{s.slug}/mcp</span></p>
        </div>
      </footer>
    </div>
  );
}
