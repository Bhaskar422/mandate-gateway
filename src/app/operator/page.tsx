import type { Metadata } from "next";
import Review from "@/components/operator/Review";
import PublicShell from "@/components/shell/PublicShell";
import { demoWallet } from "@/lib/demo-wallet";
import { listMerchants } from "@/lib/merchants";
import { isOperator, operatorConfigured } from "@/lib/operator";

export const metadata: Metadata = { title: "Operator", robots: { index: false } };
export const dynamic = "force-dynamic";

/** For the people who run this gateway: decide which stores are verified. */
export default async function OperatorPage() {
  const signedIn = await isOperator();
  return (
    <PublicShell width="max-w-[960px]" nav={false}>
      <Review configured={operatorConfigured()} signedIn={signedIn} merchants={signedIn ? await listMerchants() : []} demoWalletSetAt={signedIn ? (await demoWallet())?.setAt ?? null : null} />
    </PublicShell>
  );
}
