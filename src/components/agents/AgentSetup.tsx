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
  const stores = storeServers(appUrl);
  const P = ({ children }: { children: React.ReactNode }) => <p className="text-base text-ink-2">{children}</p>;
  /** One server per row, each with the name to give it and its own address to copy. */
  const Servers = ({ gateway }: { gateway: string }) => (
    <ul className="space-y-2">
      {[{ name: "Mandate Gateway", url: gateway, note: "Required. Carries your key." }, ...stores.map((s) => ({ name: `${s.name} catalogue`, url: s.url, note: "Optional. No key." }))].map((s) => (
        <li key={s.url}><CodeBlock label={`Name: ${s.name} · ${s.note}`} code={s.url} wrap /></li>
      ))}
    </ul>
  );
  const each = "Each server is added on its own: the gateway, which is the one that matters, and a catalogue for each store you want the agent to browse. A store outside this site has its own catalogue address, usually its web address followed by /mcp.";
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
          <P>{each} The demo stores&apos; catalogues need no key:</P>
          <Servers gateway={`${appUrl}/api/mcp`} />
        </>}
        {c === "chatgpt" && <>
          <P>ChatGPT on the web, on a plan that allows custom servers. Open <span className="font-medium text-ink">Plugins → Browse → Add (+) → Add custom MCP server</span>. Give it the name and address below, choose <span className="font-medium text-ink">No authentication</span>, and accept the warning. The key travels in the gateway&apos;s address, so treat that whole address as a secret.</P>
          <P>{each}</P>
          <Servers gateway={keyedUrl(appUrl, agentKey)} />
          <P>If your ChatGPT has no Plugins menu yet, it is the older layout: turn on developer mode under <span className="font-medium text-ink">Settings → Connectors → Advanced</span> (on some accounts <span className="font-medium text-ink">Settings → Apps &amp; Connectors → Advanced settings</span>), then choose <span className="font-medium text-ink">Create</span> on the Connectors page and enter the same name and address.</P>
        </>}
        {c === "claude-code" && <>
          <P>Run these in a terminal. One command per server. The first adds the gateway under the name <span className="code">mandate</span>, with your key; the others add each demo store&apos;s catalogue (<span className="code">stride-store</span> and so on), which need no key and are optional.</P>
          <CodeBlock label="Terminal" code={claudeCodeCommands(appUrl, agentKey)} wrap />
        </>}
        {c === "claude-desktop" && <>
          <P>Open <span className="font-medium text-ink">Settings → Developer → Edit Config</span>, paste this, and restart. It adds every server at once: the gateway as <span className="code">mandate</span> and each demo store&apos;s catalogue. Remove the store entries you do not want.</P>
          <CodeBlock label="claude_desktop_config.json" code={mcpConfig(appUrl, agentKey)} />
        </>}
        {c === "codex" && <>
          <P>Add this to <span className="code">~/.codex/config.toml</span>, or to <span className="code">.codex/config.toml</span> in a project. One block per server, named <span className="code">mandate</span>, <span className="code">stride-store</span> and so on; only <span className="code">mandate</span> is required.</P>
          <CodeBlock label="config.toml" code={codexConfig(appUrl, agentKey)} />
        </>}
        {c === "cursor" && <>
          <P>With Cursor installed on this computer, each button opens it and asks you to confirm one server, already named. The first is the gateway and includes your key; the store catalogues are optional.</P>
          <div className="flex flex-wrap gap-2">
            {cursorLinks(appUrl, agentKey).map((l, i) => <a key={l.href} href={l.href} className={`btn ${i === 0 ? "btn-primary" : "btn-secondary"}`}>{l.label}</a>)}
          </div>
          <P>Or paste this into <span className="code">.cursor/mcp.json</span>:</P>
          <CodeBlock label=".cursor/mcp.json" code={cursorConfig(appUrl, agentKey)} />
        </>}
        {c === "gemini" && <>
          <P>Merge this into <span className="code">~/.gemini/settings.json</span>. It adds every server at once under the names shown; only <span className="code">mandate</span> is required.</P>
          <CodeBlock label="settings.json" code={geminiConfig(appUrl, agentKey)} />
        </>}
        {c === "vscode" && <>
          <P>For GitHub Copilot&apos;s agent mode. Save this as <span className="code">.vscode/mcp.json</span> in your workspace. It adds every server at once under the names shown; only <span className="code">mandate</span> is required.</P>
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
