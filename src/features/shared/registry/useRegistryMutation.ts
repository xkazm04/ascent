"use client";

// The one client-side call path for every registry mutation.
//
// Three rules it exists to enforce in ONE place, because the panel has five buttons and they must not
// drift on any of them:
//   1. a call in flight disables its own button and names itself in `pending`;
//   2. a failure surfaces the route's `{ error, code }` as a sentence, INLINE — never a silent catch,
//      never a toast that scrolls away from the control that caused it;
//   3. a success calls `router.refresh()`, so the server view re-reads and the panel stops showing
//      the state that existed before the PR was opened.

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { errorSentence } from "./registryActionRules";

/**
 * True inside the preview shell. A previewed state renders the SAME buttons the real view would (that
 * is the point of previewing it), so the calls have to be neutered somewhere — and the safest place is
 * the one function that makes them. Without this, clicking "Create acme/ai-registry" while previewing
 * a fixture would create a real repository in the real org.
 */
export const RegistryPreviewContext = createContext(false);

/** What a finished call left on screen: one sentence, optionally with the PR/repo it produced. */
export interface RegistryOutcome {
  action: string;
  message: string;
  href?: string;
  hrefLabel?: string;
}

export interface RegistryMutation {
  /** The `action` key of the call in flight, or null. Compare to disable exactly one button. */
  pending: string | null;
  outcome: RegistryOutcome | null;
  error: { action: string; message: string } | null;
  run: (
    action: string,
    url: string,
    init: { body?: unknown; describe: (data: Record<string, unknown>) => Omit<RegistryOutcome, "action"> },
  ) => Promise<boolean>;
  reset: () => void;
}

export function useRegistryMutation(): RegistryMutation {
  const router = useRouter();
  const preview = useContext(RegistryPreviewContext);
  const [pending, setPending] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RegistryOutcome | null>(null);
  const [error, setError] = useState<{ action: string; message: string } | null>(null);

  const reset = useCallback(() => {
    setOutcome(null);
    setError(null);
  }, []);

  const run = useCallback<RegistryMutation["run"]>(
    async (action, url, init) => {
      if (pending) return false;
      if (preview) {
        setError(null);
        setOutcome({ action, message: "Preview — nothing was sent. This action runs for real once a registry is mapped." });
        return false;
      }
      setPending(action);
      setOutcome(null);
      setError(null);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: init.body === undefined ? undefined : { "content-type": "application/json" },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          setError({ action, message: errorSentence(data, res.status) });
          return false;
        }
        setOutcome({ action, ...init.describe(data) });
        // The server component owns the truth; re-read it rather than patching a client copy.
        router.refresh();
        return true;
      } catch {
        // A network/parse failure is still a failure the user must see stated.
        setError({ action, message: "The request could not be sent. Check your connection and try again." });
        return false;
      } finally {
        setPending(null);
      }
    },
    [pending, preview, router],
  );

  return { pending, outcome, error, run, reset };
}

/** Narrow an untyped JSON field to a string, for the `describe` callbacks. */
export const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
/** Narrow an untyped JSON field to a number. */
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
