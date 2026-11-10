import Link from "next/link";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/stores/catalog";

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const s = getStore((await params).slug);
  if (!s) notFound();
  return (
    <div className="min-h-screen bg-white">
      <header style={{ background: s.accent }} className="text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <Link href={`/stores/${s.slug}`}><span className="text-xl font-bold">{s.name}</span><span className="ml-3 text-sm opacity-80">{s.tagline}</span></Link>
          <Link href={`/stores/${s.slug}/admin`} className="text-sm underline opacity-90">Back office</Link>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-5 py-8">{children}</div>
      <footer className="mx-auto max-w-5xl px-5 pb-8 text-xs text-slate-400">Demo merchant for the Mandate gateway. Agent catalogue: <span className="mono">/stores/{s.slug}/mcp</span></footer>
    </div>
  );
}
