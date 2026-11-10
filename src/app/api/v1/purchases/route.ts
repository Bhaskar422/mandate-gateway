import { parsePurchaseRequest, submitPurchase } from "@/lib/agent-api";
import { bad, body, restAgent } from "@/lib/rest";
export const maxDuration = 60;
export async function POST(req: Request) {
  const agent = await restAgent(req);
  if (agent instanceof Response) return agent;
  const parsed = parsePurchaseRequest(await body(req));
  if (typeof parsed === "string") return bad(parsed);
  // An Idempotency-Key header works as well as the body field.
  const key = req.headers.get("idempotency-key");
  const result = await submitPurchase(agent, { ...parsed, idempotency_key: parsed.idempotency_key ?? key });
  return Response.json(result, { status: result.status === "blocked" ? 200 : 201 });
}
