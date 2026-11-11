"use client";
import { Wallet } from "lucide-react";
import { useDemoWalletAction } from "@/app/actions";
import { useAccount } from "./AccountProvider";
import { ErrorText } from "./ui/Banner";
import Button from "./ui/Button";
import { useAction } from "./useAction";

/** For a visitor with no PayPal sandbox account: borrow the gateway's shared sandbox buyer. Shown only when one is set up. */
export default function DemoWalletButton({ variant = "secondary", size = "md" }: { variant?: "primary" | "secondary"; size?: "sm" | "md" }) {
  const { state } = useAccount();
  // A server action, despite the name starting with "use".
  const take = useAction(useDemoWalletAction);
  if (state.paypal || !state.demoWallet.available) return null;
  return (
    <span className="inline-flex flex-col gap-1">
      <Button variant={variant} size={size} icon={<Wallet size={size === "sm" ? 13 : 15} aria-hidden />} loading={take.pending} loadingText="Setting up" onClick={() => take.run()}>Use the demo wallet</Button>
      <ErrorText>{take.error}</ErrorText>
    </span>
  );
}
