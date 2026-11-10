import { mandateView } from "@/lib/agent-api";
import { restAgent } from "@/lib/rest";
export async function GET(req: Request) {
  const agent = await restAgent(req);
  return agent instanceof Response ? agent : Response.json(await mandateView(agent));
}
