import type { Metadata } from "next";
import Agents from "@/components/agents/Agents";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  return <Agents startNew={(await searchParams).new === "1"} />;
}
