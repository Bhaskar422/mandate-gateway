import { submitProblem } from "@/lib/agent-api";
import { bad, body, restAgent } from "@/lib/rest";
export const maxDuration = 60;
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await restAgent(req);
  if (agent instanceof Response) return agent;
  const b = (await body(req)) as { description?: unknown } | null;
  if (typeof b?.description !== "string" || b.description.trim().length < 5) return bad("description is required: what the user says went wrong");
  const r = await submitProblem(agent, (await params).id, b.description);
  return "error" in r ? bad(r.error!, 409) : Response.json(r, { status: 201 });
}
