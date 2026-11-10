import { appUrl } from "@/lib/config";
import { publicKeyPem } from "@/lib/ledger";
export const dynamic = "force-dynamic";
export const GET = () => Response.json({ gateway: appUrl(), mcp: `${appUrl()}/api/mcp`, evidence: { algorithm: "ed25519 over sha256 hash chain", publicKey: publicKeyPem() } });
