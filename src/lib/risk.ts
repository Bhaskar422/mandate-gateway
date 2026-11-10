// Deterministic checks on the page the gateway fetched. No model is involved: these are pattern matches
// whose only effect is to send a purchase to the user for approval and to show a warning.

export type PageSignal = { kind: "agent_directed_text" | "hidden_text"; detail: string; excerpt: string };

const AGENT_DIRECTED: [RegExp, string][] = [
  // Text that speaks *to* an AI ("notice for AI assistants", "if you are an AI"), not text that merely mentions one.
  [/\b(?:notice|attention|message|instructions?|note|warning)\s+(?:for|to)\s+(?:all\s+|any\s+)?(?:ai|a\.i\.|llm|automated|shopping)\b[\w\s.-]{0,24}?\b(?:assistants?|agents?|models?|bots?)\b|\b(?:if|as|since)\s+you\s+are\s+an?\s+(?:ai|a\.i\.|llm|language\s+model|automated)\b|\bdear\s+(?:ai|assistant|agent)\b/i, "addresses AI agents directly"],
  [/\bignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts?|rules)\b/i, "tells the reader to ignore its instructions"],
  [/\b(?:system|developer)\s*(?:prompt|message|override|notice)\s*:/i, "imitates a system message"],
  [/\bdo\s+not\s+(?:mention|tell|reveal|disclose|inform)\b/i, "tells the reader to hide something from the customer"],
  [/\b(?:customer|user|buyer)\s+has\s+(?:already\s+)?(?:pre-?approved|authori[sz]ed|consented)\b/i, "claims the customer already approved something"],
  [/\b(?:you\s+(?:must|are\s+required\s+to)|store\s+policy\s+requires\s+you\s+to)\b[^.]{0,120}\b(?:instead|purchas|buy|order)/i, "instructs the reader to make a different purchase"],
];

const HIDING = /display\s*:\s*none|visibility\s*:\s*hidden|(?:left|top|text-indent)\s*:\s*-\d{3,}|font-size\s*:\s*0(?:px)?\b|opacity\s*:\s*0(?:\.0+)?\s*(?:;|"|')/i;
const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
const clip = (s: string, around = 0) => s.slice(Math.max(0, around - 60), around + 180).trim();

/** Look for text aimed at AI agents and for text hidden from human shoppers. */
export function scanPage(html: string, extraText = ""): PageSignal[] {
  const out: PageSignal[] = [];
  const body = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ");

  // Text inside elements styled or marked so a shopper cannot see it. Each opening tag is tested on its own,
  // so an outer element (such as <html>) cannot swallow the ones inside it.
  for (const m of body.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const attrs = m[2];
    if (!(HIDING.test(attrs) || /(?:^|\s)hidden(?:\s|=|$)/i.test(attrs) || /aria-hidden\s*=\s*["']?true/i.test(attrs))) continue;
    const from = m.index + m[0].length, close = body.toLowerCase().indexOf(`</${m[1].toLowerCase()}`, from);
    const text = strip(body.slice(from, close === -1 ? from + 2000 : close));
    if (text.length >= 40) { out.push({ kind: "hidden_text", detail: "text hidden from shoppers", excerpt: text.slice(0, 240) }); break; }
  }

  const visible = `${strip(body)} ${extraText}`;
  for (const [re, detail] of AGENT_DIRECTED) {
    const m = re.exec(visible);
    if (m) { out.push({ kind: "agent_directed_text", detail, excerpt: clip(visible, m.index) }); break; }
  }
  return out;
}

export const describeSignals = (s: PageSignal[]) =>
  s.some((x) => x.kind === "agent_directed_text")
    ? `The merchant's page contains text that ${s.find((x) => x.kind === "agent_directed_text")!.detail}${s.some((x) => x.kind === "hidden_text") ? ", hidden from human shoppers" : ""}. This is a common prompt-injection pattern.`
    : "The merchant's page contains text hidden from human shoppers.";
