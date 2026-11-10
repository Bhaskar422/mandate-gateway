import Overview from "@/components/overview/Overview";

export const maxDuration = 60; // approving a purchase from this page pays through PayPal

export default async function Home({ searchParams }: { searchParams: Promise<{ paypal?: string; detail?: string }> }) {
  const q = await searchParams;
  return <Overview notice={q.paypal ? { kind: q.paypal, detail: q.detail ?? null } : null} />;
}
