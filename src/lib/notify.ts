// Outbound notifications. The user gives one webhook URL (Slack, Discord, ntfy or their own endpoint) and the
// gateway posts there when something needs them. Best effort: a failed notification never fails a purchase.
import { getUser } from "./gateway-user";

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;
/** Only public https endpoints: the gateway must not be usable to reach private networks. */
export function validNotifyUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error("That is not a valid URL"); }
  if (u.protocol !== "https:") throw new Error("The notification URL must use https");
  if (PRIVATE.test(u.hostname) || !u.hostname.includes(".") || u.username || u.password) throw new Error("That address is not allowed");
  return u.toString();
}

export type NotifyEvent = { kind: "approval_needed" | "blocked" | "injection_flagged" | "agent_paused" | "offer_waiting" | "refunded" | "charged"; title: string; detail: string; url?: string };

export async function notify(userId: string, e: NotifyEvent) {
  try {
    const url = (await getUser(userId))?.settings?.notifyUrl;
    if (!url) return;
    const text = `${e.title}\n${e.detail}${e.url ? `\n${e.url}` : ""}`;
    // `text` is what Slack reads, `content` what Discord reads; other receivers get the structured fields.
    await fetch(validNotifyUrl(url), { method: "POST", headers: { "Content-Type": "application/json", Title: e.title.slice(0, 120) },
      body: JSON.stringify({ text, content: text, source: "mandate-gateway", ...e }), signal: AbortSignal.timeout(5_000), redirect: "error" });
  } catch (err) { console.error("notification failed:", err instanceof Error ? err.message : err); }
}
