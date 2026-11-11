import { releaseStaleHolds } from "@/lib/gateway";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * The daily job. It asks stores to release reservations they have left unshipped past the limit, which only ever
 * returns reserved money to buyers. When CRON_SECRET is set, the caller must present it.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Not allowed" }, { status: 401 });
  const r = await releaseStaleHolds();
  return Response.json({ checked: r.checked, released: r.released, kept: r.kept.length });
}
