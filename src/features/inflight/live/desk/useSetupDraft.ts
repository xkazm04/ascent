"use client";

// The next round's draft, kept in THIS browser only (localStorage, per org). Every read and write is
// wrapped: a private window or blocked storage simply means the draft starts from the prefill again.
// The prefill renders first (server and client agree), and a saved draft replaces it after mount.

import { useCallback, useEffect, useReducer } from "react";
import { parseDraft, reduceSetup, type SetupAction, type SetupDraft } from "./setupModel";

const keyOf = (slug: string) => `ascent.desk.next-round.${slug}`;

export function useSetupDraft(slug: string, prefill: SetupDraft): [SetupDraft, (a: SetupAction) => void, () => void] {
  const [draft, dispatch] = useReducer(reduceSetup, prefill);

  useEffect(() => {
    let saved: SetupDraft | null = null;
    try {
      saved = parseDraft(window.localStorage.getItem(keyOf(slug)));
    } catch {
      saved = null;
    }
    if (saved) dispatch({ type: "reset", draft: saved });
  }, [slug]);

  const act = useCallback(
    (a: SetupAction) => {
      const next = reduceSetup(draft, a);
      dispatch({ type: "reset", draft: next });
      try {
        window.localStorage.setItem(keyOf(slug), JSON.stringify(next));
      } catch {
        /* storage blocked: the draft lives until reload */
      }
    },
    [draft, slug],
  );

  const reset = useCallback(() => {
    dispatch({ type: "reset", draft: prefill });
    try {
      window.localStorage.removeItem(keyOf(slug));
    } catch {
      /* nothing saved to remove */
    }
  }, [prefill, slug]);

  return [draft, act, reset];
}
