"use client";

// #16 — the client fetch for the control matrix. Kept in its own hook so the panel stays a render and
// the four states (loading / error / empty / rows) are one place.
//
// The distinction the API makes is preserved here: `null` rows mean the matrix is UNAVAILABLE (no
// database, or the org is unknown) and `[]` means the org has genuinely reported nothing yet. Folding
// them together would tell an operator their fleet has no controls when the truth is that nothing was
// asked.

import { useCallback, useEffect, useState } from "react";
import type { ControlMatrixRowView } from "./controlMatrixView";

export interface ControlMatrixState {
  rows: ControlMatrixRowView[] | null;
  loading: boolean;
  error: string | null;
  expanded: Set<string>;
  toggleFamily: (family: string) => void;
}

export function useControlMatrix(org: string): ControlMatrixState {
  const [rows, setRows] = useState<ControlMatrixRowView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: raise the loading flag, then load the matrix once per org
    setLoading(true);
    setError(null);
    fetch(`/api/report/conformance/matrix?org=${encodeURIComponent(org)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { rows?: ControlMatrixRowView[]; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          // Say what went wrong. A silent empty grid here reads as "no controls", which is a
          // statement about the fleet rather than about the request that failed.
          setError(body.error ?? `Could not load the control matrix (HTTP ${res.status}).`);
          setRows(null);
          return;
        }
        setRows(Array.isArray(body.rows) ? body.rows : []);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not reach the control matrix.");
          setRows(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org]);

  const toggleFamily = useCallback((family: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  }, []);

  return { rows, loading, error, expanded, toggleFamily };
}
