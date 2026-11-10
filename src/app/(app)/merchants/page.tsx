import type { Metadata } from "next";
import Merchants from "@/components/merchants/Merchants";

export const metadata: Metadata = { title: "Merchants" };
export const maxDuration = 60; // verifying a store fetches a file from its site

export default function MerchantsPage() {
  return <Merchants />;
}
