"use client";

// State/effects/handlers for the audit-trail viewer, extracted from AuditLogViewer.tsx to keep the
// component under the 200-LOC cap (AGENTS.md / docs/ORG-TABS-REFACTOR.md). Owns no JSX.

import { useRef, useState } from "react";
import type { AuditLogEntry, AuditLogPage } from "@/lib/db";

export interface AuditLogFilters {
  action: string;
  since: string;
  until: string;
  actor: string;
}

const NO_FILTERS: AuditLogFilters = { action: "", since: "", until: "", actor: "" };

export function useAuditLogFilters(org: string, initial: AuditLogPage) {
  const [entries, setEntries] = useState<AuditLogEntry[]>(initial.entries);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [action, setAction] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [actor, setActor] = useState("");
  // security-posture-audit-log #5: the LAST-APPLIED filter set, distinct from the live inputs above.
  // The CSV href, "Load more", and the table all derive from THIS — previously the CSV anchor was
  // rebuilt from raw input state on every keystroke, so typing an actor without pressing Apply
  // exported a filter set the on-screen table had never shown (filed evidence ≠ reviewed rows).
  const [applied, setApplied] = useState<AuditLogFilters>(NO_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Monotonic request token: every load() takes the next id; a response only applies if it's still the
  // latest. Without it, rapidly changing the action filter raced two un-sequenced fetches and whichever
  // resolved LAST won — landing rows that disagree with the selected filter, or appending a "Load more"
  // page from a superseded filter (duplicate / foreign e.id rows, possible React key collisions).
  const reqId = useRef(0);

  function buildQs(f: AuditLogFilters): URLSearchParams {
    const qs = new URLSearchParams({ org });
    if (f.action) qs.set("action", f.action);
    if (f.since) qs.set("since", f.since);
    if (f.until) qs.set("until", f.until);
    if (f.actor.trim()) qs.set("actorId", f.actor.trim());
    return qs;
  }

  async function load(reset: boolean, nextCursor: string | null, f: AuditLogFilters) {
    const myReq = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const qs = buildQs(f);
      if (!reset && nextCursor) qs.set("cursor", nextCursor);
      const res = await fetch(`/api/audit?${qs.toString()}`);
      const data = await res.json();
      // A newer load() superseded this one — drop the stale result so it can't scramble the list or
      // append a page belonging to a prior filter.
      if (myReq !== reqId.current) return;
      if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status}).`);
      setEntries((prev) => (reset ? data.entries : [...prev, ...data.entries]));
      setCursor(data.nextCursor);
    } catch (e) {
      if (myReq !== reqId.current) return;
      setError(e instanceof Error ? e.message : "Failed to load audit log.");
    } finally {
      if (myReq === reqId.current) setLoading(false);
    }
  }

  // Explicit values passed to load() so a just-changed control isn't read from stale state. The
  // Action select auto-applies (over the last-APPLIED date/actor set — mixing in typed-but-unapplied
  // inputs would silently apply filters the user never confirmed); date/actor apply via the form's
  // submit (the Apply button, or Enter in any field).
  function changeAction(value: string) {
    setAction(value);
    const f = { ...applied, action: value };
    setApplied(f);
    void load(true, null, f);
  }
  function applyFilters(e?: React.FormEvent) {
    e?.preventDefault();
    const f = { action, since, until, actor };
    setApplied(f);
    void load(true, null, f);
  }
  function loadMore() {
    void load(false, cursor, applied);
  }

  /** Download href for the APPLIED filter set — the CSV always matches the rows on screen. */
  const csvHref = `/api/audit?${buildQs(applied).toString()}&format=csv`;

  return {
    entries,
    cursor,
    action,
    since,
    until,
    actor,
    loading,
    error,
    csvHref,
    setSince,
    setUntil,
    setActor,
    changeAction,
    applyFilters,
    loadMore,
  };
}
