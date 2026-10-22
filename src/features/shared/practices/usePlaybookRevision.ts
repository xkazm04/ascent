"use client";

// playbooks-1: state for the revision rollout on a playbook card. Loads who is behind (GET
// /api/org/playbooks/:id/revise), preselects exactly the behind repos, holds the typed confirm and runs
// the admin POST. The server re-checks every bound (admin, revisable set, cap, digest-bound replace);
// this only makes the action legible and hard to fire by accident.

import { useState } from "react";
import { readApiResponse, type BatchResult } from "./practiceApplyShared";
import {
  MAX_REVISION_BATCH,
  revisionConfirmCopy,
  revisionConfirmReady,
  type RevisionSets,
} from "@/lib/org/playbookRevisionModel";

export type RevisionPhase = "idle" | "loading" | "ready" | "running" | "done" | "error";

/** The repos a run may select: every behind repo, plus unversioned ones with a landed digest. */
export function selectableRepos(sets: RevisionSets | null): string[] {
  if (!sets) return [];
  return [...sets.behind.map((b) => b.repo), ...sets.unversioned.filter((u) => u.revisable).map((u) => u.repo)];
}

/** Succeeded repos leave behind / unversioned and join in-flight (their revision PR is open). */
export function moveToInFlight(sets: RevisionSets, ok: readonly string[]): RevisionSets {
  const done = new Set(ok);
  return {
    ...sets,
    behind: sets.behind.filter((b) => !done.has(b.repo)),
    unversioned: sets.unversioned.filter((u) => !done.has(u.repo)),
    inFlight: [...new Set([...sets.inFlight, ...ok])].sort(),
  };
}

export function usePlaybookRevision({ playbookId, org }: { playbookId: string; org: string }) {
  const [phase, setPhase] = useState<RevisionPhase>("idle");
  const [sets, setSets] = useState<RevisionSets | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const selectable = selectableRepos(sets);
  const selectedRepos = selectable.filter((r) => selected.has(r)).slice(0, MAX_REVISION_BATCH);
  const copy = revisionConfirmCopy(org, selectedRepos, sets?.version ?? 0);
  const confirm = { org, repos: selectedRepos, ...copy, ready: revisionConfirmReady(typed, org) };

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const read = await readApiResponse<RevisionSets>(await fetch(`/api/org/playbooks/${playbookId}/revise`), "Failed to load the repos on older versions.");
      if (!read.ok) throw new Error(read.error);
      setSets(read.data);
      setSelected(new Set(read.data.behind.map((b) => b.repo)));
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the repos on older versions.");
      setPhase("error");
    }
  }

  function toggle(repo: string) {
    if (!selectable.includes(repo)) return;
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      return next;
    });
  }

  async function run() {
    // The typed confirm is the gate: without the exact org slug nothing is sent.
    if (!confirm.ready || selectedRepos.length === 0 || !sets) return;
    setPhase("running");
    setError(null);
    try {
      const res = await fetch(`/api/org/playbooks/${playbookId}/revise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repos: selectedRepos }),
      });
      const read = await readApiResponse<{ results: BatchResult[]; skipped?: unknown }>(res, "Failed to open the revision PRs.");
      if (!read.ok) throw new Error(read.error);
      const rows = read.data.results;
      const ok = rows.filter((r) => r.ok).map((r) => r.repo);
      setResults(rows);
      setSkipped(typeof read.data.skipped === "number" ? read.data.skipped : 0);
      setSets(moveToInFlight(sets, ok));
      setSelected((s) => new Set([...s].filter((r) => !ok.includes(r))));
      setConfirming(false);
      setTyped("");
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open the revision PRs.");
      setPhase("ready");
    }
  }

  return {
    phase,
    sets,
    selected,
    selectedRepos,
    selectable,
    typed,
    setTyped,
    confirming,
    setConfirming,
    confirm,
    results,
    skipped,
    error,
    load,
    toggle,
    run,
  };
}
