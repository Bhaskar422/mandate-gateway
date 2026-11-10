import { STORES } from "@/lib/stores/catalog";

// Ready-to-paste setup for an agent. Used where a key is shown and on the developer page (with a placeholder key).
export const KEY_PLACEHOLDER = "mk_your_agent_key";

const remote = (url: string, key?: string) => ({ command: "npx", args: ["-y", "mcp-remote", url, ...(key ? ["--header", `Authorization: Bearer ${key}`] : [])] });

/** claude_desktop_config.json: the gateway plus each demo store's catalogue server. */
export const mcpConfig = (appUrl: string, key: string) => JSON.stringify({
  mcpServers: {
    mandate: remote(`${appUrl}/api/mcp`, key),
    ...Object.fromEntries(STORES.map((s) => [`${s.slug}-store`, remote(`${appUrl}/stores/${s.slug}/mcp`)])),
  },
}, null, 2);

export const mcpCommand = (appUrl: string, key: string) => `npx -y mcp-remote ${appUrl}/api/mcp --header "Authorization: Bearer ${key}"`;

export const storeServers = (appUrl: string) => STORES.map((s) => ({ name: s.name, url: `${appUrl}/stores/${s.slug}/mcp` }));

export const curlPurchase = (appUrl: string, key: string) => `curl -X POST ${appUrl}/api/v1/purchases \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-001" \\
  -d '{
    "product_url": "${appUrl}/stores/stride/products/STR-TEMPO3",
    "expected_price": 89.00,
    "user_request": "Buy me road running shoes under $100",
    "reason": "A cushioned daily trainer at $89"
  }'`;
