import { AccountProvider } from "@/components/AccountProvider";
import AppShell from "@/components/shell/AppShell";
import { currentUserId } from "@/lib/session";
import { dashboardState } from "@/lib/views";

export const dynamic = "force-dynamic";

/** Every page in this group belongs to the signed-in (cookie) user and shares one live copy of their account. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const initial = await dashboardState(await currentUserId());
  return <AccountProvider initial={initial}><AppShell>{children}</AppShell></AccountProvider>;
}
