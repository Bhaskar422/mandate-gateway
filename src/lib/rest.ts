import { agentFromKey } from "./gateway";

/** Authenticate a REST call with the same agent key the MCP server uses. */
export async function restAgent(req: Request) {
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const agent = await agentFromKey(key);
  return agent ?? Response.json({ error: { code: "unauthorized", message: "Send your agent key as 'Authorization: Bearer mk_...'. Create one in the Mandate dashboard." } }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
}
export const bad = (message: string, status = 400) => Response.json({ error: { code: status === 404 ? "not_found" : "invalid_request", message } }, { status });
export const body = async (req: Request) => { try { return await req.json(); } catch { return null; } };
