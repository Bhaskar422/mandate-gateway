import { runAssistant, type AssistantEvent, type ChatTurn } from "@/lib/assistant";
import { currentUserId } from "@/lib/session";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** One message to the built-in shopping assistant. The reply streams back as JSON lines. */
export async function POST(req: Request) {
  let userId: string;
  try { userId = await currentUserId(); } catch { return Response.json({ error: "No session" }, { status: 401 }); }
  const body = (await req.json().catch(() => null)) as { messages?: unknown } | null;
  const history: ChatTurn[] = (Array.isArray(body?.messages) ? body.messages : [])
    .filter((m): m is ChatTurn => !!m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.trim().length > 0);
  if (!history.length || history[history.length - 1].role !== "user") return Response.json({ error: "Send at least one user message" }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AssistantEvent) => { try { controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`)); } catch { /* the reader went away */ } };
      try { await runAssistant(userId, history, emit); }
      catch (e) { emit({ type: "error", message: e instanceof Error ? e.message : "Something went wrong." }); }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
