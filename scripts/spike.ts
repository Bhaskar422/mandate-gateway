// Checks the credentials and the PayPal money route, step by step. Prints no secrets.
import Anthropic from "@anthropic-ai/sdk";
import { gatewayCreds, paypalBase, storeCreds, storePayee } from "../src/lib/config";

async function token(c: { clientId: string; secret: string }) {
  const r = await fetch(`${paypalBase()}/v1/oauth2/token`, { method: "POST", body: "grant_type=client_credentials",
    headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" } });
  const j = await r.json();
  return { ok: r.ok, status: r.status, scopes: String(j.scope ?? "").split(" ").filter(Boolean), appId: j.app_id, error: j.error_description, token: j.access_token as string | undefined };
}
async function main() {
  const g = gatewayCreds(), s = storeCreds("stride");
  for (const [name, c] of [["gateway", g], ["stride", s]] as const) {
    if (!c) { console.log(`${name}: credentials missing`); continue; }
    const t = await token(c);
    console.log(`${name}: token ${t.ok ? "OK" : `FAILED ${t.status} ${t.error}`}`);
    if (t.ok) {
      const has = (x: string) => t.scopes.some((sc) => sc.includes(x));
      console.log(`   scopes: vault=${has("vault")} payments=${has("payments/")} disputes=${has("disputes")} (${t.scopes.length} total)`);
      const u = await fetch(`${paypalBase()}/v1/identity/oauth2/userinfo?schema=paypalv1.1`, { headers: { Authorization: `Bearer ${t.token}` } });
      const uj = await u.json().catch(() => ({}));
      console.log(`   account: payer_id=${uj.payer_id ?? "?"} ${name === "stride" ? `matches MERCHANT_ID=${uj.payer_id === storePayee("stride").merchantId}` : ""}`);
    }
  }
  if (g) {
    const t = await token(g);
    const r = await fetch(`${paypalBase()}/v3/vault/setup-tokens`, { method: "POST", headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json", "PayPal-Request-Id": `spike-${Date.now()}` },
      body: JSON.stringify({ payment_source: { paypal: { usage_type: "MERCHANT", experience_context: { return_url: "http://localhost:3000/api/paypal/return", cancel_url: "http://localhost:3000/" } } } }) });
    const j = await r.json();
    console.log(`vault setup token: ${r.ok ? `OK status=${j.status}` : `FAILED ${r.status} ${j.name} ${JSON.stringify(j.details ?? j.message)}`}`);
  }
  try {
    const m = await new Anthropic().messages.create({ model: process.env.LLM_MODEL ?? "claude-opus-5-5", max_tokens: 50, messages: [{ role: "user", content: "Reply with the single word: ready" }] });
    console.log(`anthropic: OK (${m.model}) ${m.content.find((b) => b.type === "text")?.text?.trim()}`);
  } catch (e) { console.log(`anthropic: FAILED ${e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e}`); }
}
main();
