// Show what PayPal reports about disputes for the gateway app and the Stride app.
// Usage: tsx --env-file=.env.local scripts/list-disputes.ts [captureId]
import { gatewayCreds, paypalBase, storeCreds, type PayPalCreds } from "../src/lib/config";

async function token(c: PayPalCreds) {
  const r = await fetch(paypalBase() + "/v1/oauth2/token", {
    method: "POST",
    body: "grant_type=client_credentials",
    headers: { Authorization: "Basic " + Buffer.from(c.clientId + ":" + c.secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
  });
  return (await r.json()).access_token as string;
}

async function show(name: string, c: PayPalCreds | null, captureId?: string) {
  if (!c) return;
  const headers = { Authorization: "Bearer " + (await token(c)) };
  const queries = ["?page_size=20", ...(captureId ? ["?disputed_transaction_id=" + captureId] : [])];
  for (const q of queries) {
    const r = await fetch(paypalBase() + "/v1/customer/disputes" + q, { headers });
    const j = await r.json();
    const items = (j.items ?? []) as { dispute_id: string; reason: string; status: string; dispute_life_cycle_stage?: string; create_time?: string }[];
    console.log(name + " " + q + " -> " + r.status + ", " + items.length + " dispute(s)" + (r.ok ? "" : " " + JSON.stringify(j).slice(0, 300)));
    for (const d of items) {
      const full = await (await fetch(paypalBase() + "/v1/customer/disputes/" + d.dispute_id, { headers })).json();
      console.log("   " + d.dispute_id + " | " + d.reason + " | " + d.status + " | " + d.dispute_life_cycle_stage + " | created " + d.create_time);
      console.log("   seller txn " + full.disputed_transactions?.[0]?.seller_transaction_id + " | buyer txn " + full.disputed_transactions?.[0]?.buyer_transaction_id + " | amount " + full.dispute_amount?.value);
      console.log("   actions allowed: " + (full.links ?? []).map((l: { rel: string }) => l.rel).join(", "));
    }
  }
}

async function main() {
  await show("stride", storeCreds("stride"), process.argv[2]);
  await show("gateway", gatewayCreds(), process.argv[2]);
}
main().catch((e) => { console.error(String(e)); process.exit(1); });
