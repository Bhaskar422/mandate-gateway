import { purchaseStatus } from "@/lib/agent-api";
import { bad, restAgent } from "@/lib/rest";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await restAgent(req);
  if (agent instanceof Response) return agent;
  const p = await purchaseStatus(agent, (await params).id);
  return p ? Response.json(p) : bad("No such purchase", 404);
}
