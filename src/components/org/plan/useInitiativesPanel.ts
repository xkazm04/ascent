"use client";

// State + handlers for the Initiatives panel (InitiativesPanel.tsx) — extracted per the extraction
// order in docs/ORG-TABS-REFACTOR.md §3 (state/effects/handlers → use<Feature><Thing>.ts, owns no
// JSX) so the component file stays under the 200-LOC cap.

import { useState } from "react";
import type { GoalOption, InitiativeView, SeedRec } from "@/components/org/plan/InitiativesPanelTypes";

export function useInitiativesPanel({ slug, initial, goals }: { slug: string; initial: InitiativeView[]; goals: GoalOption[] }) {
  const [items, setItems] = useState<InitiativeView[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/org/initiatives?org=${encodeURIComponent(slug)}`);
    if (res.ok) setItems((await res.json()).initiatives ?? []);
  }

  async function track(seed: SeedRec) {
    setBusy(seed.title);
    setError(null);
    try {
      const res = await fetch("/api/org/initiatives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // No targetScore: the single server-side default (DEFAULT_INITIATIVE_TARGET in the maturity
        // model) rules — this panel used to hardcode its own 70 next to the DB layer's (goals #4 07-16).
        body: JSON.stringify({ org: slug, title: seed.title, dimId: seed.dimId, practiceId: seed.practiceId, repos: seed.repos }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
    }
  }

  // Optimistically patch one initiative and persist the same fields. `goalLabel` is kept in sync
  // locally when the link changes so the chip updates without a refetch.
  async function patch(id: string, body: Partial<Pick<InitiativeView, "status" | "assigneeLogin" | "targetDate" | "goalId">>) {
    // Optimistic patch WITH a failure path: previously the PATCH response was ignored, so a failed write
    // (403/404/network) left the UI showing a status/assignee/due/goal-link the server never accepted.
    // Snapshot first, then restore + surface the error if the write didn't persist (goals-initiatives #2).
    const prev = items;
    // Client half of the optimistic-lock protocol (goals-initiatives 07-16 #3): send the last-seen
    // value of exactly the fields this patch writes, so the server's compare-and-set guards the whole
    // "since this row rendered" window — without `expected` it only guarded the milliseconds between
    // its own read and write, and two admins with stale tabs still clobbered each other silently.
    const row = items.find((i) => i.id === id);
    const expected = row
      ? Object.fromEntries((Object.keys(body) as (keyof typeof body)[]).map((k) => [k, row[k]]))
      : undefined;
    setItems((xs) =>
      xs.map((i) =>
        i.id === id
          ? { ...i, ...body, ...("goalId" in body ? { goalLabel: goals.find((g) => g.id === body.goalId)?.label ?? null } : {}) }
          : i,
      ),
    );
    setError(null);
    try {
      const res = await fetch(`/api/org/initiatives/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, expected }),
      });
      if (res.status === 409) {
        // A concurrent editor won the same field: pull the authoritative snapshot so the user retries
        // against what actually persisted, instead of a generic error over a reverted stale row.
        setItems(prev);
        await refresh();
        setError("This initiative changed concurrently. The list was reloaded, please retry.");
        return;
      }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to update initiative.");
    } catch (e) {
      setItems(prev);
      setError(e instanceof Error ? e.message : "Failed to update initiative.");
    }
  }

  return { items, busy, error, track, patch };
}
