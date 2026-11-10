import { ledgerHead, publicKeyPem } from "@/lib/ledger";
// Public and signed. Anyone can record this value now and later prove the ledger was not rewritten behind it.
export const dynamic = "force-dynamic";
export const GET = async () => Response.json({ ...(await ledgerHead()), publicKey: publicKeyPem() });
