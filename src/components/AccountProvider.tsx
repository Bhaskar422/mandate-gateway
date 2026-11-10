"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { DashboardState } from "@/lib/views";

type Account = { state: DashboardState; refresh: () => Promise<void> };
const Ctx = createContext<Account | null>(null);

/** Holds the signed-in user's read model for every dashboard page and keeps it live by polling. */
export function AccountProvider({ initial, children }: { initial: DashboardState; children: React.ReactNode }) {
  const [state, setState] = useState(initial);
  const last = useRef("");
  useEffect(() => { setState(initial); last.current = ""; }, [initial]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/activity", { cache: "no-store" });
      if (!r.ok) return;
      const text = await r.text();
      // Only swap the state in when something changed, so open forms and menus are not re-rendered every poll.
      if (text !== last.current) { last.current = text; setState(JSON.parse(text)); }
    } catch { /* offline or mid-deploy: keep showing what we have */ }
  }, []);

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) refresh(); }, 3000);
    const onShow = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onShow); };
  }, [refresh]);

  return <Ctx.Provider value={{ state, refresh }}>{children}</Ctx.Provider>;
}

export function useAccount() {
  const a = useContext(Ctx);
  if (!a) throw new Error("useAccount must be used inside the dashboard");
  return a;
}
/** For components that also render on public pages, where there is no session. */
export const useOptionalAccount = () => useContext(Ctx);
