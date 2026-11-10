import type { Metadata } from "next";
import ActivityFeed from "@/components/purchases/ActivityFeed";

export const metadata: Metadata = { title: "Activity" };
export const maxDuration = 60; // approving, reporting a problem and answering an offer call the model and PayPal

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ status?: string; agent?: string; merchant?: string; flagged?: string; q?: string }> }) {
  const q = await searchParams;
  return <ActivityFeed initial={{ status: q.status, agent: q.agent, merchant: q.merchant, flagged: q.flagged === "1", q: q.q }} />;
}
