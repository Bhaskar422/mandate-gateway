"use client";
import { useCallback, useState } from "react";
import { useOptionalAccount } from "./AccountProvider";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Run a server action with a pending flag and the error text it returned. Server actions here take seconds
 * (they call a model or PayPal), so every caller disables its button while `pending` is true.
 */
export function useAction<A extends unknown[], T extends object>(action: (...args: A) => Promise<Result<T>>) {
  const account = useOptionalAccount();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (...args: A): Promise<({ ok: true } & T) | null> => {
    setPending(true); setError(null);
    try {
      const r = await action(...args);
      if (!r.ok) { setError(r.error); return null; }
      await account?.refresh();
      return r;
    } catch {
      setError("That did not go through. Check your connection and try again.");
      return null;
    } finally { setPending(false); }
  }, [action, account]);

  return { run, pending, error, clearError: () => setError(null) };
}
