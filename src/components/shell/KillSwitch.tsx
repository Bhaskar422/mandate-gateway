"use client";
import { OctagonX, Play } from "lucide-react";
import { setFrozenAction } from "@/app/actions";
import { useAccount } from "../AccountProvider";
import LocalTime from "../LocalTime";
import Banner, { ErrorText } from "../ui/Banner";
import Button from "../ui/Button";
import { useAction } from "../useAction";

/**
 * The kill switch. Freezing takes one click on purpose: it is the emergency control, and it is undone with
 * one click on "Unfreeze", so there is no confirmation step in the way.
 */
export function KillSwitch({ layout }: { layout: "sidebar" | "compact" | "panel" }) {
  const { state } = useAccount();
  const { run, pending, error } = useAction(setFrozenAction);
  const frozen = state.account.frozen;

  if (layout === "compact") {
    return frozen
      ? <Button variant="danger-solid" size="sm" loading={pending} icon={<Play size={13} aria-hidden />} onClick={() => run(false)}>Unfreeze</Button>
      : <Button variant="danger" size="sm" loading={pending} icon={<OctagonX size={13} aria-hidden />} onClick={() => run(true)} aria-label="Freeze all agent spending">Freeze</Button>;
  }

  return (
    <div className={layout === "sidebar" ? `rounded-[10px] border p-3 ${frozen ? "tone-bad tone-softbg border-transparent" : "border-line bg-raised"}` : ""}>
      {layout === "sidebar" && <p className={`eyebrow mb-2 ${frozen ? "tone-bad tone-text" : ""}`}>{frozen ? "Spending is frozen" : "Kill switch"}</p>}
      {frozen
        ? <Button variant="danger-solid" className={layout === "sidebar" ? "w-full" : ""} loading={pending} loadingText="Unfreezing" icon={<Play size={15} aria-hidden />} onClick={() => run(false)}>Unfreeze spending</Button>
        : <Button variant="danger" className={layout === "sidebar" ? "w-full" : ""} loading={pending} loadingText="Freezing" icon={<OctagonX size={15} aria-hidden />} onClick={() => run(true)}>Freeze all agent spending</Button>}
      {layout === "sidebar" && !frozen && <p className="mt-2 text-xs text-ink-3">Blocks every agent purchase at once. Undo it any time.</p>}
      {error && <div className="mt-2"><ErrorText>{error}</ErrorText></div>}
    </div>
  );
}

/** Shown on every dashboard page while the account is frozen. */
export function FrozenBanner() {
  const { state } = useAccount();
  const { run, pending, error } = useAction(setFrozenAction);
  if (!state.account.frozen) return null;
  return (
    <Banner tone="bad" role="alert" icon={<OctagonX size={18} aria-hidden />} title="All agent spending is frozen"
      action={<Button variant="danger-solid" size="sm" loading={pending} loadingText="Unfreezing" onClick={() => run(false)}>Unfreeze</Button>}>
      Every purchase request is being blocked{state.account.frozenAt && <>, since <LocalTime iso={state.account.frozenAt} /></>}. Approvals that were waiting cannot be paid until you unfreeze.
      {error && <ErrorText>{error}</ErrorText>}
    </Banner>
  );
}
