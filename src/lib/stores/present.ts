// How the in-app demo stores answer an agent that shows a mandate credential. The check itself is in
// verify-mandate.ts, which has no gateway dependency; this file only supplies the store's address, its catalogue
// and the gateway key it has pinned.
import { appUrl } from "@/lib/config";
import { publicKeyPem } from "@/lib/ledger";
import type { Store } from "./catalog";
import { presentMandate, type StoreView } from "./verify-mandate";

/** A real merchant pins this from the gateway's /.well-known/mandate-gateway.json. */
const pinnedGatewayKey = () => publicKeyPem();

export const storeUrl = (s: Store) => `${appUrl()}/stores/${s.slug}`;
export const storeView = (s: Store): StoreView => ({ name: s.name, url: storeUrl(s), verified: s.verified,
  products: s.products.map((p) => ({ sku: p.sku, name: p.name, priceCents: p.priceCents, currency: "USD", category: p.category, url: `${storeUrl(s)}/products/${p.sku}` })) });

/** Verify the credential offline and answer from this store's side. */
export const presentToStore = (s: Store, credential: unknown) => presentMandate(credential, storeView(s), { publicKeyPem: pinnedGatewayKey(), issuer: appUrl() });

/** A credential that arrives as JSON text (an agent may pass it either way) is parsed; anything else is passed through. */
export function asCredential(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
}
