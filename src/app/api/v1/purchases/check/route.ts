import { parsePurchaseRequest, previewPurchase } from "@/lib/agent-api";
import { bad, body, restAgent } from "@/lib/rest";
export const maxDuration = 60;
export async function POST(req: Request) {
  const agent = await restAgent(req);
  if (agent instanceof Response) return agent;
  const parsed = parsePurchaseRequest(await body(req));
  return typeof parsed === "string" ? bad(parsed) : Response.json(await previewPurchase(agent, parsed));
}
