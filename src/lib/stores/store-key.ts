// The signing keys of the demo stores that run inside this app. A real store generates its own key pair and keeps
// the private half to itself; these are derived from the gateway's key and the store's slug so the demo needs no
// extra secret. Each store still gets a different key, and the gateway checks them like any other store's.
import { derivedSecret } from "../ledger";
import { privateKeyFromSeed, publicPemOf, signRequest } from "./sign-request";

export const storePrivateKey = (slug: string) => privateKeyFromSeed(derivedSecret(`mandate store request signing v1:${slug}`));
/** What the store publishes as "signing_key" in its well-known file. */
export const storePublicKey = (slug: string) => publicPemOf(storePrivateKey(slug));
/** The signature headers for one request from this store to the gateway. */
export const storeSignature = (slug: string, r: { method: string; path: string; body?: string | null }) => signRequest(storePrivateKey(slug), r);
