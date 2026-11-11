import { mandateCredential } from "@/lib/agent-api";
import { restAgent } from "@/lib/rest";

// A short-lived, signed statement of what this agent may buy for a user. The agent shows it to a store; the store
// verifies it offline against the gateway's public key. Pass ?store_url=<the store's address> to bind it to one
// store. It names no payment details and no personal data, and authorises nothing by itself.
export async function GET(req: Request) {
  const agent = await restAgent(req);
  if (agent instanceof Response) return agent;
  const q = new URL(req.url).searchParams;
  const c = await mandateCredential(agent, q.get("store_url") ?? q.get("audience"));
  return "error" in c ? Response.json(c, { status: c.error.code === "no_mandate" ? 404 : 400 }) : Response.json(c);
}
