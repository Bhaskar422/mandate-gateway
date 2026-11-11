"use client";
import { useState } from "react";
import { CodeBlock } from "../ui/Copy";
import { claudeCodeCommands, codexConfig, curlPurchase, cursorConfig, cursorLinks, geminiConfig, keyedUrl, mcpCommand, mcpConfig, storeServers, vscodeCommand, vscodeConfig } from "./snippets";

// "Any MCP client" comes first because it applies to everything; the named clients follow in alphabetical order.
const CLIENTS = [
  { id: "mcp", label: "Any MCP client" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "codex", label: "Codex CLI" },
  { id: "cursor", label: "Cursor" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "vscode", label: "VS Code" },
  { id: "rest", label: "REST API" },
] as const;
type ClientId = (typeof CLIENTS)[number]["id"];

/** Ready-to-paste setup for an agent, for each client we have checked the format of. */
export default function AgentSetup({ appUrl, agentKey }: { appUrl: string; agentKey: string }) {
  const [c, setC] = useState<ClientId>("mcp");
  const stores = storeServers(appUrl).map((s) => `${s.url}   # ${s.name}`).join("\n");
  const P = ({ children }: { children: React.ReactNode }) => <p className="text-base text-ink-2">{children}</p>;
  return (
    <div>
      <div role="tablist" aria-label="Which agent are you connecting?" className="flex flex-wrap gap-1.5">
        {CLIENTS.map((t) => (
          <button key={t.id} role="tab" type="button" id={`tab-${t.id}`} aria-selected={c === t.id} aria-controls="setup-panel" onClick={() => setC(t.id)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${c === t.id ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:border-line-strong hover:text-ink"}`}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel" id="setup-panel" aria-labelledby={`tab-${c}`} className="space-y-3 pt-4">
        {c === "mcp" && <>
          <P>The gateway is a remote MCP server (Streamable HTTP) at <span className="code">{appUrl}/api/mcp</span>. Send the key as a bearer token. For clients that only launch local commands:</P>
          <CodeBlock label="Gateway" code={mcpCommand(appUrl, agentKey)} wrap />
          <P>The demo stores&apos; catalogues need no key:</P>
          <CodeBlock label="Store catalogues" code={stores} />
        </>}
        {c === "chatgpt" && <>
          <P>In ChatGPT, turn on developer mode under <span className="font-medium text-ink">Settings → Connectors → Advanced</span>, create a connector with this address and choose no authentication. The key travels in the address, so treat the whole address as a secret.</P>
          <CodeBlock label="Connector address" code={keyedUrl(appUrl, agentKey)} wrap />
          <P>Add the store catalogues the same way; they need no key:</P>
          <CodeBlock label="Store catalogues" code={stores} />
        </>}
        {c === "claude-code" && <>
          <P>Run these in a terminal. The first adds the gateway with your key; the others add the demo stores&apos; catalogues, which need no key.</P>
          <CodeBlock label="Terminal" code={claudeCodeCommands(appUrl, agentKey)} wrap />
        </>}
        {c === "claude-desktop" && <>
          <P>Open <span className="font-medium text-ink">Settings → Developer → Edit Config</span>, paste this, and restart. It adds the gateway and the demo stores&apos; catalogues.</P>
          <CodeBlock label="claude_desktop_config.json" code={mcpConfig(appUrl, agentKey)} />
        </>}
        {c === "codex" && <>
          <P>Add this to <span className="code">~/.codex/config.toml</span>, or to <span className="code">.codex/config.toml</span> in a project.</P>
          <CodeBlock label="config.toml" code={codexConfig(appUrl, agentKey)} />
        </>}
        {c === "cursor" && <>
          <P>With Cursor installed on this computer, each button opens it and asks you to confirm the server. The key is included in the first one.</P>
          <div className="flex flex-wrap gap-2">
            {cursorLinks(appUrl, agentKey).map((l, i) => <a key={l.href} href={l.href} className={`btn ${i === 0 ? "btn-primary" : "btn-secondary"}`}>{l.label}</a>)}
          </div>
          <P>Or paste this into <span className="code">.cursor/mcp.json</span>:</P>
          <CodeBlock label=".cursor/mcp.json" code={cursorConfig(appUrl, agentKey)} />
        </>}
        {c === "gemini" && <>
          <P>Merge this into <span className="code">~/.gemini/settings.json</span>.</P>
          <CodeBlock label="settings.json" code={geminiConfig(appUrl, agentKey)} />
        </>}
        {c === "vscode" && <>
          <P>For GitHub Copilot&apos;s agent mode. Save this as <span className="code">.vscode/mcp.json</span> in your workspace:</P>
          <CodeBlock label=".vscode/mcp.json" code={vscodeConfig(appUrl, agentKey)} />
          <P>Or add just the gateway from a terminal:</P>
          <CodeBlock label="Terminal" code={vscodeCommand(appUrl, agentKey)} wrap />
        </>}
        {c === "rest" && <>
          <P>For agents and frameworks without MCP, the same operations are plain HTTPS calls.</P>
          <CodeBlock label="Request a purchase" code={curlPurchase(appUrl, agentKey)} />
        </>}
      </div>
    </div>
  );
}
