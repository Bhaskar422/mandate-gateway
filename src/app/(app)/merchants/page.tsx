import type { Metadata } from "next";
import Merchants from "@/components/merchants/Merchants";

export const metadata: Metadata = { title: "Merchants" };

export default function MerchantsPage() {
  return <Merchants />;
}
