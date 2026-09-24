"use client";

// The cockpit run hook's action wrapper, extracted from `useLoopRun.ts` so that file stays under the
// 200-LOC cap for `src/features/**`. Pure relocation: `busy` is the in-flight action's own fetch, and
// `guard` runs one action with `busy` raised and the shared error cleared, reporting a failure through
// the caller's `setError` and resolving to null instead of throwing.

import { useCallback, useState } from "react";

export function useBusyGuard(setError: (message: string | null) => void) {
  const [busy, setBusy] = useState(false);
  const guard = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [setError],
  );
  return { busy, guard };
}
