"use client";

// Debounces the gate-policy editor's draft to the read-only preview route and keeps only the latest
// draft's answer (policyPreviewModel owns the meaning; this owns the timer and the fetch). The draft
// the form opened with is the saved bar, so it previews nothing: the hook stays idle until an edit.

import { useEffect, useReducer, useRef, useState } from "react";
import type { GatePolicy } from "@/lib/scoring/gate";
import { INITIAL_PREVIEW, derivePreview, previewReducer, type PolicyPreviewData, type PreviewView } from "./policyPreviewModel";

/** Long enough to coalesce typing a two-digit floor, short enough to read as live. */
const DEBOUNCE_MS = 450;

function isPreview(d: unknown): d is PolicyPreviewData {
  return !!d && typeof d === "object" && "impact" in d && !!(d as { impact?: unknown }).impact;
}

export function usePolicyPreview(org: string, draft: GatePolicy): PreviewView {
  const key = JSON.stringify(draft);
  const [baseKey] = useState(key);
  const [state, dispatch] = useReducer(previewReducer, INITIAL_PREVIEW);
  const seq = useRef(0);

  useEffect(() => {
    const n = ++seq.current;
    if (key === baseKey) {
      if (n > 1) dispatch({ type: "idle", seq: n });
      return;
    }
    dispatch({ type: "edit", seq: n });
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      dispatch({ type: "request", seq: n });
      try {
        const res = await fetch("/api/org/gate-policy/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ org, policy: JSON.parse(key) as GatePolicy }),
          signal: ctrl.signal,
        });
        const d: unknown = await res.json().catch(() => null);
        if (!res.ok || !isPreview(d)) {
          const msg = d && typeof d === "object" && "error" in d ? String((d as { error: unknown }).error) : null;
          throw new Error(msg ?? "The impact preview is unavailable; Save still works.");
        }
        dispatch({ type: "response", seq: n, data: d });
      } catch (e) {
        if (ctrl.signal.aborted) return;
        dispatch({ type: "error", seq: n, message: e instanceof Error ? e.message : "The impact preview is unavailable." });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [org, key, baseKey]);

  return derivePreview(state);
}
