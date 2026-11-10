// Register (or find) the PayPal webhook for the gateway app and for each store app.
// Usage: tsx --env-file=.env.local scripts/register-webhooks.ts https://your-host
// Prints the env var names and webhook ids to set. Safe to run again: it reuses an existing webhook for the same URL.
import { gatewayCreds, paypalBase, storeCreds, type PayPalCreds } from "../src/lib/config";

const EVENTS = ["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED", "CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"];

async function token(c: PayPalCreds) {
  const r = await fetch(paypalBase() + "/v1/oauth2/token", {
    method: "POST",
    body: "grant_type=client_credentials",
    headers: { Authorization: "Basic " + Buffer.from(c.clientId + ":" + c.secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
  });
  return (await r.json()).access_token as string;
}

async function ensure(name: string, envVar: string, c: PayPalCreds | null, url: string) {
  if (!c) { console.log(name + ": no credentials, skipped"); return; }
  const headers = { Authorization: "Bearer " + (await token(c)), "Content-Type": "application/json" };
  const list = await (await fetch(paypalBase() + "/v1/notifications/webhooks", { headers })).json();
  const existing = (list.webhooks ?? []).find((w: { url: string }) => w.url === url);
  if (existing) { console.log(envVar + "=" + existing.id + "   (" + name + ": already registered)"); return; }
  const res = await fetch(paypalBase() + "/v1/notifications/webhooks", { method: "POST", headers, body: JSON.stringify({ url, event_types: EVENTS.map((e) => ({ name: e })) }) });
  const j = await res.json();
  if (!res.ok) { console.log(name + ": FAILED " + res.status + " " + j.name + " " + JSON.stringify(j.details ?? j.message)); return; }
  console.log(envVar + "=" + j.id + "   (" + name + ": created)");
}

async function main() {
  const host = (process.argv[2] ?? "").replace(/\/$/, "");
  if (!/^https:\/\//.test(host)) throw new Error("Pass the public https base URL of the deployment");
  const url = host + "/api/webhooks/paypal";
  await ensure("gateway", "PAYPAL_WEBHOOK_ID", gatewayCreds(), url);
  await ensure("stride", "PAYPAL_STORE_STRIDE_WEBHOOK_ID", storeCreds("stride"), url);
}
main().catch((e) => { console.error(String(e)); process.exit(1); });
