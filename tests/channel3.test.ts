import { describe, expect, it } from "vitest";
import { readProducts } from "../src/lib/channel3";

const reply = { products: [
  { title: "Pour-Over Kettle", brands: [{ name: "Fire Maple" }], category: { title: "Stovetop Kettles" }, offers: [
    { url: "https://buy.example/a", domain: "www.Dear-Shop.com", availability: "OutOfStock", price: { price: 20, currency: "USD" } },
    { url: "https://buy.example/b", domain: "firemaplegear.com", availability: "InStock", price: { price: 34.95, currency: "USD" } }] },
  { title: "No offers", offers: [] },
  { offers: [{ url: "https://buy.example/c", domain: "x.com" }] },
] };

describe("reading a wider-search reply", () => {
  it("keeps the in-stock offer and the fields the assistant needs", () =>
    expect(readProducts(reply)).toEqual([{ title: "Pour-Over Kettle", brand: "Fire Maple", category: "Stovetop Kettles", price: "34.95", currency: "USD", image: null, store: "firemaplegear.com", link: "https://buy.example/b" }]));
  it("drops products with no title or no offer", () => expect(readProducts(reply)).toHaveLength(1));
  it("returns nothing for a reply it cannot read", () => { expect(readProducts(null)).toEqual([]); expect(readProducts({ error: "x" })).toEqual([]); });
  it("takes the main picture, and only from Channel3's image host", () => {
    const one = (images: unknown) => readProducts({ products: [{ title: "T", images, offers: [{ url: "https://u", domain: "shop.com" }] }] })[0].image;
    expect(one([{ url: "https://cdn.trychannel3.com/a" }, { url: "https://cdn.trychannel3.com/b?aid=1&mid=x", is_main_image: true }])).toBe("https://cdn.trychannel3.com/b?aid=1&mid=x");
    expect(one([{ url: "https://evil.example/x.png" }, { url: "javascript:alert(1)" }])).toBeNull();
    expect(one(undefined)).toBeNull();
  });
  it("normalises the store's host", () =>
    expect(readProducts({ products: [{ title: "T", offers: [{ url: "https://u", domain: "WWW.Shop.com" }] }] })[0].store).toBe("shop.com"));
});
