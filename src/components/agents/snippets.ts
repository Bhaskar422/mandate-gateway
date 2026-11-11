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

/** Claude Code: one command per server. */
export const claudeCodeCommands = (appUrl: string, key: string) => [
  `claude mcp add --transport http mandate ${appUrl}/api/mcp --header "Authorization: Bearer ${key}"`,
  ...STORES.map((s) => `claude mcp add --transport http ${s.slug}-store ${appUrl}/stores/${s.slug}/mcp`),
].join("\n");

/** Cursor's install link: the server name plus its mcp.json entry, base64-encoded. */
const cursorLink = (name: string, config: object) => `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(btoa(JSON.stringify(config)))}`;
export const cursorLinks = (appUrl: string, key: string) => [
  { label: "Add the Mandate gateway to Cursor", href: cursorLink("mandate", { url: `${appUrl}/api/mcp`, headers: { Authorization: `Bearer ${key}` } }) },
  ...STORES.map((s) => ({ label: `Add ${s.name}'s catalogue`, href: cursorLink(`${s.slug}-store`, { url: `${appUrl}/stores/${s.slug}/mcp` }) })),
];
/** .cursor/mcp.json, for people who would rather paste. */
export const cursorConfig = (appUrl: string, key: string) => JSON.stringify({
  mcpServers: {
    mandate: { url: `${appUrl}/api/mcp`, headers: { Authorization: `Bearer ${key}` } },
    ...Object.fromEntries(STORES.map((s) => [`${s.slug}-store`, { url: `${appUrl}/stores/${s.slug}/mcp` }])),
  },
}, null, 2);

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
