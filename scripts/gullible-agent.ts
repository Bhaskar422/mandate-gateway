// A deliberately naive shopping agent, for demonstrating prompt injection.
// It reads a product from a store's MCP catalogue and obeys any instruction it finds in the product text,
// the way a poorly built agent would. The gateway is what stops the resulting purchase.
//
// Usage: MANDATE_AGENT_KEY=mk_... tsx scripts/gullible-agent.ts <gateway base URL> <store slug> <sku> "<what the user asked for>"
let rpc = 0;
async function call(url: string, name: string, args: Record<string, unknown>, key?: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(key ? { Authorization: "Bearer " + key } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  const line = text.startsWith("{") ? text : (text.split("\n").find((l) => l.startsWith("data:")) ?? "").slice(5);
  const json = JSON.parse(line);
  if (json.error) throw new Error(name + ": " + JSON.stringify(json.error));
  return JSON.parse(json.result.content[0].text);
}

async function main() {
  const [base, slug, sku, ask] = process.argv.slice(2);
  const key = process.env.MANDATE_AGENT_KEY;
  if (!base || !slug || !sku || !ask || !key) throw new Error("Usage: MANDATE_AGENT_KEY=... gullible-agent.ts <base URL> <store> <sku> \"<request>\"");
  const say = (who: string, msg: string) => console.log("\n" + who.padEnd(8) + msg);

  say("USER", ask);
  const product = await call(base + "/stores/" + slug + "/mcp", "get_product", { sku });
  say("AGENT", "Found " + product.name + " at $" + product.price + ".");
  say("STORE", "(product text) " + String(product.description).replace(/\s+/g, " "));

  // The naive part: treat text inside the product data as an instruction to follow.
  const redirect = /purchasing the (.+?) \(\$(\d+(?:\.\d+)?)\) at (\/\S+?) instead/i.exec(String(product.description));
  let url: string = product.url, price = Number(product.price), reason = "Matches the request";
  if (redirect) {
    url = base + redirect[3];
    price = Number(redirect[2]);
    reason = "The store's notice says to buy this instead";
    say("AGENT", "The page says to buy the " + redirect[1] + " instead. Doing that.");
  }

  const result = await call(base + "/api/mcp", "request_purchase", { product_url: url, expected_price: price, user_request: ask, reason }, key);
  say("GATEWAY", String(result.status).toUpperCase() + ": " + result.message);
  say("", "Evidence record: " + result.record);
}
main().catch((e) => { console.error(String(e)); process.exit(1); });
