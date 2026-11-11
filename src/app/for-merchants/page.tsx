import type { Metadata } from "next";
import MerchantPortal from "@/components/merchants/Portal";
import UnmetDemand from "@/components/merchants/UnmetDemand";
import { unmetDemand } from "@/lib/channel3";
import PublicShell from "@/components/shell/PublicShell";
import { appUrl } from "@/lib/config";
import { insightsForRegistrant } from "@/lib/merchant-insights";
import { listMerchants } from "@/lib/merchants";
import { currentUserId } from "@/lib/session";

export const metadata: Metadata = { title: "For merchants" };
export const dynamic = "force-dynamic";
export const maxDuration = 60; // proving ownership fetches a file from the store's site

/** The merchant's side of the gateway. It shares nothing with a shopper's dashboard except the registry itself. */
export default async function ForMerchantsPage() {
  const userId = await currentUserId();
  // Insights are loaded only for stores this browser registered; the check is on merchants.registeredBy, on the server.
  const [merchants, insights, unmet] = await Promise.all([listMerchants(userId), insightsForRegistrant(userId), unmetDemand(14)]);
  return <PublicShell width="max-w-[960px]"><MerchantPortal merchants={merchants} insights={insights} appUrl={appUrl()} /><UnmetDemand stores={unmet} days={14} /></PublicShell>;
}
