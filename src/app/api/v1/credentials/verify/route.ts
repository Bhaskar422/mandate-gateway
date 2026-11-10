import { verifyPayload } from "@/lib/ledger";
import { body } from "@/lib/rest";

// Public: a merchant checks a credential an agent presented.
export async function POST(req: Request) {
  const signed = (await body(req)) as { payload?: { expiresAt?: string; type?: string }; signature?: string } | null;
  if (!signed?.payload || !signed.signature) return Response.json({ valid: false, reason: "Send the credential exactly as issued: { payload, signature }." }, { status: 400 });
  if (!verifyPayload(signed)) return Response.json({ valid: false, reason: "The signature does not match this gateway's key." });
  const expired = !signed.payload.expiresAt || new Date(signed.payload.expiresAt).getTime() < Date.now();
  return Response.json({ valid: !expired, reason: expired ? "The credential has expired." : "Signed by this gateway and still current.", payload: signed.payload });
}
