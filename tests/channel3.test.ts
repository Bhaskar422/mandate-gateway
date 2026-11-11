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
    expect(readProducts(reply)).toEqual([{ title: "Pour-Over Kettle", brand: "Fire Maple", category: "Stovetop Kettles", price: "34.95", currency: "USD", store: "firemaplegear.com", link: "https://buy.example/b" }]));
  it("drops products with no title or no offer", () => expect(readProducts(reply)).toHaveLength(1));
  it("returns nothing for a reply it cannot read", () => { expect(readProducts(null)).toEqual([]); expect(readProducts({ error: "x" })).toEqual([]); });
  it("normalises the store's host", () =>
    expect(readProducts({ products: [{ title: "T", offers: [{ url: "https://u", domain: "WWW.Shop.com" }] }] })[0].store).toBe("shop.com"));
});
