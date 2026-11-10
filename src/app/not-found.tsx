import Link from "next/link";
import PublicShell from "@/components/shell/PublicShell";

export default function NotFound() {
  return (
    <PublicShell width="max-w-[520px]">
      <div className="card p-6 text-center sm:p-8">
        <p className="eyebrow">Not found</p>
        <h1 className="display mt-2 text-2xl text-ink">There is nothing at this address</h1>
        <p className="mt-2 text-base text-ink-2">The page may have moved, or the purchase belongs to a different browser session. Purchase records are only visible in the session that made them.</p>
        <Link href="/" className="btn btn-primary mt-5">Go to the dashboard</Link>
      </div>
    </PublicShell>
  );
}
