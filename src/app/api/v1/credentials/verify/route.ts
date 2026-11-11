import { checkCredential } from "@/lib/credential";
import { body } from "@/lib/rest";

// Public: check a credential an agent presented. A store does not need this call: the same check runs offline
// with the gateway's public key (src/lib/stores/verify-mandate.ts). Add "audience" to also check which store it is for.
export async function POST(req: Request) {
  const signed = (await body(req)) as { payload?: unknown; signature?: unknown; audience?: unknown } | null;
  if (!signed?.payload || !signed.signature) return Response.json({ valid: false, reason: "Send the credential exactly as issued: { payload, signature }." }, { status: 400 });
  const v = checkCredential(signed, typeof signed.audience === "string" ? signed.audience : null);
  return Response.json(v.ok ? { valid: true, reason: "Signed by this gateway and still current.", payload: v.payload } : { valid: false, code: v.code, reason: v.reason, payload: signed.payload });
}
