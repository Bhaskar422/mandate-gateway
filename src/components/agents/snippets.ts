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

const servers = (appUrl: string) => [{ name: "mandate", url: `${appUrl}/api/mcp`, auth: true }, ...STORES.map((s) => ({ name: `${s.slug}-store`, url: `${appUrl}/stores/${s.slug}/mcp`, auth: false }))];
const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

/** VS Code (GitHub Copilot): .vscode/mcp.json uses a top-level "servers" object. */
export const vscodeConfig = (appUrl: string, key: string) => JSON.stringify({
  servers: Object.fromEntries(servers(appUrl).map((s) => [s.name, { type: "http", url: s.url, ...(s.auth ? { headers: bearer(key) } : {}) }])),
}, null, 2);
export const vscodeCommand = (appUrl: string, key: string) => `code --add-mcp '${JSON.stringify({ name: "mandate", type: "http", url: `${appUrl}/api/mcp`, headers: bearer(key) })}'`;

/** Gemini CLI: ~/.gemini/settings.json, remote servers under "httpUrl". */
export const geminiConfig = (appUrl: string, key: string) => JSON.stringify({
  mcpServers: Object.fromEntries(servers(appUrl).map((s) => [s.name, { httpUrl: s.url, ...(s.auth ? { headers: bearer(key) } : {}) }])),
}, null, 2);

/** Codex CLI: ~/.codex/config.toml. */
export const codexConfig = (appUrl: string, key: string) => servers(appUrl).map((s) =>
  `[mcp_servers.${s.name}]\nurl = "${s.url}"${s.auth ? `\nhttp_headers = { Authorization = "Bearer ${key}" }` : ""}`).join("\n\n");

/** For clients that take only a URL: the gateway also accepts the key as a query parameter. */
export const keyedUrl = (appUrl: string, key: string) => `${appUrl}/api/mcp?key=${key}`;

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
