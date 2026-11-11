// How each demo storefront presents itself. The catalogue (names, prices, photos, the accent colour) lives in
// src/lib/stores/catalog.ts; this only adds the look and the shop-window copy so the three read as different shops.
export type StoreTheme = {
  /** Classes for the shop's name and headings. */
  heading: string;
  /** Corner radius for cards and panels. */
  radius: string;
  /** The shop's name as it appears in its own header. */
  wordmark: string;
  heroEyebrow: string; heroTitle: string; heroBody: string;
  /** Unsplash photo id for the shop window. */
  heroPhoto: string;
  /** Heading above the product grid. */
  gridTitle: string;
  /** Three short promises shown under the hero. */
  perks: { title: string; body: string }[];
  /** A strip above the header, for the kind of shop that has one. */
  promo?: string;
  /** Small print under the price on product pages. */
  shipping: string;
  /** A closing band at the foot of the shop's front page. */
  closing: { title: string; body: string };
};

const THEMES: Record<string, StoreTheme> = {
  stride: {
    heading: "font-sans font-bold tracking-tight", radius: "rounded-2xl", wordmark: "Stride",
    heroEyebrow: "Autumn road season", heroTitle: "Built for the next mile.",
    heroBody: "Road shoes, race shoes and the kit that goes with them, tested by people who run every day.",
    heroPhoto: "1562183241-b937e95585b6", gridTitle: "Shop everything",
    perks: [
      { title: "Free shipping over $75", body: "Out the door in one working day." },
      { title: "60-day returns", body: "Even on shoes you have run in." },
      { title: "Fitted by runners", body: "Write to us for sizing help." },
    ],
    shipping: "Free shipping over $75 · 60-day returns, even on worn shoes",
    closing: { title: "Not sure which shoe?", body: "Tell us your weekly miles and where you run. We answer every message within a day, and we will say so if the cheaper shoe is the right one." },
  },
  kickz: {
    heading: "font-sans font-black uppercase italic tracking-tight", radius: "rounded-none", wordmark: "Kickz",
    heroEyebrow: "Flash sale ends tonight", heroTitle: "Big-name looks. Outlet prices.",
    heroBody: "New drops every week. When they are gone, they are gone.",
    heroPhoto: "1631377816476-46b74bb0f3e8", gridTitle: "Today's deals",
    perks: [
      { title: "Up to 80% off", body: "Every pair, every day." },
      { title: "Ships worldwide", body: "From overseas in 15 to 30 days." },
      { title: "All sales final", body: "No returns, no exchanges." },
    ],
    promo: "FLASH SALE · UP TO 80% OFF · SHIPS FROM OVERSEAS IN 15 TO 30 DAYS · ALL SALES FINAL",
    shipping: "Ships from overseas in 15 to 30 days · All sales final",
    closing: { title: "Blink and it's gone.", body: "Stock is limited and prices change daily. Sizes run small on some styles, so check before you order: all sales are final." },
  },
  peak: {
    heading: "font-serif font-medium tracking-tight", radius: "rounded-lg", wordmark: "Peak Trail Supply",
    heroEyebrow: "Salida, Colorado · est. 2014", heroTitle: "Kit for where the pavement ends.",
    heroBody: "A small trail shop in Colorado. We stock what we run in, and we answer our own email.",
    heroPhoto: "1788206857337-a6c63eafdacd", gridTitle: "What we carry",
    perks: [
      { title: "Ships in 2 days", body: "Packed by hand in Colorado." },
      { title: "Repairs for life", body: "On anything we sell." },
      { title: "Trail tested", body: "Every item has done a season with us." },
    ],
    shipping: "Ships from Colorado in 2 days · Repairs for life on anything we sell",
    closing: { title: "Four things, chosen carefully.", body: "We would rather carry four items we trust than forty we have not run in. If something fails on the trail, send it back and we will mend or replace it." },
  },
};

export const storeTheme = (slug: string): StoreTheme => THEMES[slug] ?? THEMES.stride;
