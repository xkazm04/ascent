"use client";

// The whole-trail integrity sweep for the audit viewer: one GET /api/audit/integrity over the APPLIED
// filter query (the same query the CSV link is built from), plus the "show tampered" table view.
//
// A summary is keyed by the query it checked. When the applied filters change, the summary no longer
// describes the rows on screen, so it is dropped (derived, not cleared in an effect) and `stale` says
// why the verdict went away. A response for a superseded query lands under its own key and is never
// shown against the new filters.

import { useRef, useState } from "react";
import type { AuditIntegritySummary } from "./auditIntegrityModel";

export function useAuditIntegritySweep(appliedQs: string) {
  const [result, setResult] = useState<{ qs: string; summary: AuditIntegritySummary } | null>(null);
  const [pendingQs, setPendingQs] = useState<string | null>(null);
  const [error, setError] = useState<{ qs: string; message: string } | null>(null);
  const [view, setView] = useState<"trail" | "tampered">("trail");
  const reqId = useRef(0);

  const summary = result && result.qs === appliedQs ? result.summary : null;
  const stale = result != null && result.qs !== appliedQs;

  async function verify() {
    const myReq = ++reqId.current;
    const qs = appliedQs;
    setPendingQs(qs);
    setError(null);
    try {
      const res = await fetch(`/api/audit/integrity?${qs}`);
      const data = await res.json();
      if (myReq !== reqId.current) return;
      if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status}).`);
      setResult({ qs, summary: data as AuditIntegritySummary });
      setView("trail");
    } catch (e) {
      if (myReq !== reqId.current) return;
      setError({ qs, message: e instanceof Error ? e.message : "Failed to verify the audit log." });
    } finally {
      if (myReq === reqId.current) setPendingQs(null);
    }
  }

  return {
    summary,
    stale,
    loading: pendingQs === appliedQs,
    error: error && error.qs === appliedQs ? error.message : null,
    /** The table shows the sweep's tampered rows only while the summary still matches the filters. */
    showingTampered: view === "tampered" && summary != null && summary.tamperedEntries.length > 0,
    verify,
    showTampered: () => setView("tampered"),
    back: () => setView("trail"),
  };
}
