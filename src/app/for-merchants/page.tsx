import type { Metadata } from "next";
import MerchantPortal from "@/components/merchants/Portal";
import PublicShell from "@/components/shell/PublicShell";
import { appUrl } from "@/lib/config";
import { listMerchants } from "@/lib/merchants";
import { currentUserId } from "@/lib/session";

export const metadata: Metadata = { title: "For merchants" };
export const dynamic = "force-dynamic";
export const maxDuration = 60; // proving ownership fetches a file from the store's site

/** The merchant's side of the gateway. It shares nothing with a shopper's dashboard except the registry itself. */
export default async function ForMerchantsPage() {
  const merchants = await listMerchants(await currentUserId());
  return <PublicShell width="max-w-[960px]"><MerchantPortal merchants={merchants} appUrl={appUrl()} /></PublicShell>;
}
