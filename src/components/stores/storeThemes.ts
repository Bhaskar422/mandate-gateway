// How each demo storefront presents itself. The catalogue (names, prices, the accent colour) lives in
// src/lib/stores/catalog.ts; this only adds the look and the shop-window copy so the three read as different shops.
export type StoreTheme = {
  /** Classes for the shop's name and headings. */
  heading: string;
  /** Corner radius for cards and panels. */
  radius: string;
  heroTitle: string; heroBody: string;
  /** A strip above the header, for the kind of shop that has one. */
  promo?: string;
  /** Small print under the price on product pages. */
  shipping: string;
  /** Solid accent header, or a quiet one on the page colour. */
  header: "solid" | "quiet";
};

const THEMES: Record<string, StoreTheme> = {
  stride: {
    heading: "font-sans font-bold tracking-tight", radius: "rounded-2xl", header: "quiet",
    heroTitle: "Built for the next mile.", heroBody: "Road shoes, race shoes and the kit that goes with them, tested by people who run every day.",
    shipping: "Free shipping over $75 · 60-day returns, even on worn shoes",
  },
  kickz: {
    heading: "font-sans font-black uppercase italic tracking-tight", radius: "rounded-none", header: "solid",
    heroTitle: "Brand-name kicks. Outlet prices.", heroBody: "New drops every week. When they are gone, they are gone.",
    promo: "FLASH SALE · UP TO 80% OFF · SHIPS FROM OVERSEAS IN 15 TO 30 DAYS · ALL SALES FINAL",
    shipping: "Ships from overseas in 15 to 30 days · All sales final",
  },
  peak: {
    heading: "font-serif font-medium tracking-tight", radius: "rounded-lg", header: "quiet",
    heroTitle: "Kit for where the pavement ends.", heroBody: "A small trail shop in Colorado. We stock what we run in, and we answer our own email.",
    shipping: "Ships from Colorado in 2 days · Repairs for life on anything we sell",
  },
};

export const storeTheme = (slug: string): StoreTheme => THEMES[slug] ?? THEMES.stride;
