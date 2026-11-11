"use client";
import { KeyRound, TriangleAlert } from "lucide-react";
import { useState } from "react";
import Button from "../ui/Button";
import { CodeBlock, CopyButton } from "../ui/Copy";
import { claudeCodeCommands, curlPurchase, cursorConfig, cursorLinks, mcpCommand, mcpConfig, storeServers } from "./snippets";

const TABS = [{ id: "desktop", label: "Claude Desktop" }, { id: "code", label: "Claude Code" }, { id: "cursor", label: "Cursor" }, { id: "mcp", label: "Any MCP client" }, { id: "rest", label: "REST" }] as const;

/** An agent key, shown exactly once, with setup that already contains it. */
export default function KeyReveal({ agentName, agentKey, appUrl, rotated = false, onDone }: { agentName: string; agentKey: string; appUrl: string; rotated?: boolean; onDone: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("desktop");
  return (
    <section className="card rise mb-8 border-brand p-5 shadow-card sm:p-6" aria-label={`Key for ${agentName}`}>
      <p className="eyebrow">{rotated ? "New key" : "Agent connected"}</p>
      <h2 className="display mt-1 text-xl text-ink sm:text-2xl">{rotated ? `New key for “${agentName}”` : `“${agentName}” is ready. Give it this key.`}</h2>

      <div className="mt-4 rounded-[10px] border border-line-strong bg-sunken p-3">
        <div className="flex flex-wrap items-center gap-3">
          <KeyRound size={17} className="shrink-0 text-ink-3" aria-hidden />
          <code className="code min-w-0 flex-1 break-all text-[13px] text-ink">{agentKey}</code>
          <CopyButton text={agentKey} label="Copy key" />
        </div>
      </div>
      <p className="mt-2 flex items-start gap-2 text-sm text-warn-ink"><TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
        This is the only time the key is shown. The gateway stores a hash of it, not the key.{rotated && " The old key stopped working the moment this one was made."}</p>

      <div className="mt-5">
        <div role="tablist" aria-label="Setup instructions" className="flex gap-1 overflow-x-auto border-b border-line">
          {TABS.map((t) => (
            <button key={t.id} role="tab" type="button" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} onClick={() => setTab(t.id)}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${tab === t.id ? "border-brand text-brand-ink" : "border-transparent text-ink-3 hover:text-ink"}`}>{t.label}</button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="space-y-3 pt-4">
          {tab === "desktop" && <>
            <p className="text-base text-ink-2">In Claude Desktop open <span className="font-medium text-ink">Settings → Developer → Edit Config</span>, paste this, and restart. It adds the gateway and the demo stores&apos; catalogues.</p>
            <CodeBlock label="claude_desktop_config.json" code={mcpConfig(appUrl, agentKey)} />
          </>}
          {tab === "code" && <>
            <p className="text-base text-ink-2">Run these in a terminal. The first adds the gateway with your key; the others add the demo stores&apos; catalogues, which need no key.</p>
            <CodeBlock label="Terminal" code={claudeCodeCommands(appUrl, agentKey)} wrap />
          </>}
          {tab === "cursor" && <>
            <p className="text-base text-ink-2">With Cursor installed on this computer, each button opens it and asks you to confirm the server. The key is included in the first one.</p>
            <div className="flex flex-wrap gap-2">
              {cursorLinks(appUrl, agentKey).map((l, i) => <a key={l.href} href={l.href} className={`btn ${i === 0 ? "btn-primary" : "btn-secondary"}`}>{l.label}</a>)}
            </div>
            <p className="text-base text-ink-2">Or paste this into <span className="code">.cursor/mcp.json</span>:</p>
            <CodeBlock label=".cursor/mcp.json" code={cursorConfig(appUrl, agentKey)} />
          </>}
          {tab === "mcp" && <>
            <p className="text-base text-ink-2">The gateway is a remote MCP server at <span className="code">{appUrl}/api/mcp</span>. Send the key as a bearer token. For clients that only launch local commands:</p>
            <CodeBlock label="Gateway" code={mcpCommand(appUrl, agentKey)} wrap />
            <p className="text-base text-ink-2">The store catalogues need no key:</p>
            <CodeBlock label="Store catalogues" code={storeServers(appUrl).map((s) => `${s.url}   # ${s.name}`).join("\n")} />
          </>}
          {tab === "rest" && <>
            <p className="text-base text-ink-2">For agents and frameworks without MCP, the same operations are plain HTTPS calls.</p>
            <CodeBlock label="Request a purchase" code={curlPurchase(appUrl, agentKey)} />
          </>}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button variant="primary" onClick={onDone}>I have saved the key</Button>
        <span className="text-sm text-ink-3">Lost it later? Rotate the key from the agent&apos;s card to get a new one.</span>
      </div>
    </section>
  );
}
