import Link from "next/link";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

/** The header and footer keep one width on every public page, so they do not jump when the page's own column is narrower. */
const FRAME = "max-w-[1040px]";

/** The frame for pages that need no session: the verifier, the developer docs and approval links. */
export default function PublicShell({ children, width = "max-w-[960px]", nav = true }: { children: React.ReactNode; width?: string; nav?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className={`mx-auto flex w-full ${FRAME} items-center justify-between gap-3 px-4 py-3 sm:px-6`}>
          <Link href="/" aria-label="Mandate, home"><Logo size={24} /></Link>
          <nav aria-label="Site" className="flex items-center gap-1 text-sm font-medium">
            {nav && <>
              <Link href="/" className="btn btn-quiet btn-sm">Dashboard</Link>
              <Link href="/verify" className="btn btn-quiet btn-sm max-sm:!hidden">Verify a record</Link>
              <Link href="/developers" className="btn btn-quiet btn-sm">Developers</Link>
            </>}
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main className={`mx-auto w-full ${width} flex-1 px-4 py-7 sm:px-6 sm:py-10`}>{children}</main>
      <footer className="border-t border-line">
        <p className={`mx-auto w-full ${FRAME} px-4 py-5 text-xs text-ink-3 sm:px-6`}>
          Mandate is a gateway between AI shopping agents and a PayPal account. This deployment runs against the PayPal sandbox.
        </p>
      </footer>
    </div>
  );
}
