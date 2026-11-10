import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
export const metadata: Metadata = { title: "Mandate", description: "The trust layer for agent payments on PayPal" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className={`${sans.variable} ${mono.variable} antialiased`}>{children}</body></html>;
}
