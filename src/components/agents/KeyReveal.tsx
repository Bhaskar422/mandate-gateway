"use client";
import { KeyRound, TriangleAlert } from "lucide-react";
import Button from "../ui/Button";
import { CopyButton } from "../ui/Copy";
import AgentSetup from "./AgentSetup";

/** An agent key, shown exactly once, with setup that already contains it. */
export default function KeyReveal({ agentName, agentKey, appUrl, rotated = false, onDone }: { agentName: string; agentKey: string; appUrl: string; rotated?: boolean; onDone: () => void }) {
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

      <div className="mt-5"><AgentSetup appUrl={appUrl} agentKey={agentKey} /></div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button variant="primary" onClick={onDone}>I have saved the key</Button>
        <span className="text-sm text-ink-3">Lost it later? Rotate the key from the agent&apos;s card to get a new one.</span>
      </div>
    </section>
  );
}
