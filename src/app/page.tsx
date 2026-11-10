import Dashboard from "@/components/Dashboard";
import { currentUserId } from "@/lib/session";
import { dashboardState } from "@/lib/views";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // server actions on this page call the model and PayPal
export default async function Home({ searchParams }: { searchParams: Promise<{ paypal?: string; detail?: string }> }) {
  const q = await searchParams;
  return <Dashboard initial={await dashboardState(await currentUserId())} notice={q.paypal ? { kind: q.paypal, detail: q.detail ?? null } : null} />;
}
