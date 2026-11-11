import { BadgeCheck, CircleCheck, CircleDashed } from "lucide-react";
import type { MerchantView } from "@/lib/views";
import type { Tone } from "../format";

/** The three standings a store can have with the gateway, and what each one lets a mandate do. */
export const TRUST: Record<MerchantView["trust"], { label: string; tone: Tone; icon: React.ReactNode; meaning: string; how: string }> = {
  pending: { label: "Ownership not proved", tone: "warn", icon: <CircleDashed size={13} aria-hidden />,
    meaning: "Someone entered the store's address, but the store has not shown that it owns the site. It cannot be paid.",
    how: "Enter the store's address in the merchant portal." },
  registered: { label: "Registered", tone: "info", icon: <CircleCheck size={13} aria-hidden />,
    meaning: "The store proved it owns its website and named the PayPal account to pay. Allowed only by mandates that name the store or accept any registered store.",
    how: "The store publishes a file on its own site, and the gateway reads it." },
  verified: { label: "Verified", tone: "ok", icon: <BadgeCheck size={13} aria-hidden />,
    meaning: "Reviewed and approved by the people who run this gateway. Mandates that say “known merchants only” allow these and nothing else.",
    how: "Granted by the gateway's operator after a review. A store cannot give it to itself." },
};
export const TRUST_ORDER: MerchantView["trust"][] = ["pending", "registered", "verified"];
