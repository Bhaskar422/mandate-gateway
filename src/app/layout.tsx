import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const body = Geist({ variable: "--font-body", subsets: ["latin"] });
const code = Geist_Mono({ variable: "--font-code", subsets: ["latin"] });
const display = Newsreader({ variable: "--font-display", subsets: ["latin"], style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "Mandate", template: "%s · Mandate" },
  description: "Proof for every agent purchase on PayPal. Agents buy inside rules the buyer set, and a signed record of every step settles refunds and disputes for the buyer and the store.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f5f3ee" }, { media: "(prefers-color-scheme: dark)", color: "#121311" }] };

/** Applies a saved light/dark choice before the first paint. With no saved choice the system setting applies. */
const themeScript = `try{var t=localStorage.getItem("mandate-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${code.variable} ${display.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
