import type { Metadata } from "next";
import Mandates from "@/components/mandates/Mandates";

export const metadata: Metadata = { title: "Mandates" };
export const maxDuration = 60; // compiling a mandate calls the model

export default async function MandatesPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  return <Mandates startNew={(await searchParams).new === "1"} />;
}
