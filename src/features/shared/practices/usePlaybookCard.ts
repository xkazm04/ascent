"use client";

// State + handlers for one playbook card (PlaybookCard.tsx) — extracted per the extraction order in
// docs/ORG-TABS-REFACTOR.md §3 so the component file stays JSX + wiring only, under the 200-LOC cap.

import { useState } from "react";
import type { PlaybookAdoption, PlaybookRow } from "@/lib/db";
import { readApiResponse } from "./practiceApplyShared";

export function usePlaybookCard({ playbook: p, adoption }: { playbook: PlaybookRow; adoption: PlaybookAdoption | undefined }) {
  const [applied, setApplied] = useState<string[]>(adoption?.appliedRepos ?? []);
  // Repos with this playbook's draft PR open but not yet landed (row 40). Kept apart from `applied`:
  // an open draft is proposed, and only the rescan that finds the file makes it adopted.
  const [proposed, setProposed] = useState<string[]>(adoption?.proposedRepos ?? []);
  const [pick, setPick] = useState("");
  const [prBusy, setPrBusy] = useState(false);
  const [prResult, setPrResult] = useState<{ url: string; reused: boolean } | null>(null);
  const [prError, setPrError] = useState<string | null>(null);
  // "Open draft PR" writes a real branch+commit+PR into the customer's repo — gate it behind a confirm
  // that names the repo, so a stray click on a button that sits next to "Mark applied" can't file a PR.
  const [confirmingPr, setConfirmingPr] = useState(false);
  // Error surface for the adoption mark/unmark actions. Previously a failed mark/unmark just rolled
  // the optimistic chip back with zero feedback (only `prError` existed, scoped to the Open-PR flow),
  // so a 403/404 (e.g. "Repo must belong to …") or network blip read as "the click did nothing".
  // (playbooks #3)
  const [markError, setMarkError] = useState<string | null>(null);
  // A fleet rollout is in flight — the single-repo "Open draft PR" locks while it runs (and vice
  // versa), so the two PR-write paths can never double-write the same branch concurrently.
  const [batchBusy, setBatchBusy] = useState(false);

  async function apply() {
    const repo = pick;
    if (!repo || applied.includes(repo)) return;
    setApplied((a) => [...a, repo]); // optimistic
    setPick("");
    setMarkError(null);
    // Roll the optimistic add back if the server didn't record it — otherwise the card shows the repo
    // as adopted while the DB has no row, seeding phantom Initiatives + skewed lift analytics. Surface
    // the reason (mirroring PlaybooksPanel.remove) so a silent rollback isn't read as a no-op.
    try {
      const res = await fetch(`/api/org/playbooks/${p.id}/repos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo }),
      });
      if (!res.ok) {
        setApplied((a) => a.filter((r) => r !== repo));
        const data = await res.json().catch(() => ({}));
        setMarkError(data.error ?? `Couldn't record adoption for ${repo}.`);
      }
    } catch {
      setApplied((a) => a.filter((r) => r !== repo));
      setMarkError(`Couldn't record adoption for ${repo}.`);
    }
  }

  // Open a draft PR seeding the playbook into the picked repo. The repo is PROPOSED, not adopted: the
  // route no longer stamps the adoption mark on a draft (row 40).
  async function openPr() {
    const repo = pick;
    if (!repo || prBusy) return;
    setPrBusy(true);
    setPrError(null);
    setPrResult(null);
    try {
      const res = await fetch(`/api/org/playbooks/${p.id}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo }),
      });
      const read = await readApiResponse<{ url: string; reused: boolean }>(res, "Failed to open PR.");
      if (!read.ok) throw new Error(read.error);
      setPrResult({ url: read.data.url, reused: read.data.reused });
      setProposed((a) => (a.includes(repo) ? a : [...a, repo]));
      setPick("");
    } catch (e) {
      setPrError(e instanceof Error ? e.message : "Failed to open PR.");
    } finally {
      setPrBusy(false);
    }
  }

  async function unapply(repo: string) {
    setApplied((a) => a.filter((r) => r !== repo)); // optimistic
    setMarkError(null);
    // Re-add on failure so the card can't show a repo as un-adopted while the DB still has the row,
    // and surface the reason so the rollback isn't a silent no-op.
    try {
      const res = await fetch(`/api/org/playbooks/${p.id}/repos`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo }),
      });
      if (!res.ok) {
        setApplied((a) => (a.includes(repo) ? a : [...a, repo]));
        const data = await res.json().catch(() => ({}));
        setMarkError(data.error ?? `Couldn't remove adoption for ${repo}.`);
      }
    } catch {
      setApplied((a) => (a.includes(repo) ? a : [...a, repo]));
      setMarkError(`Couldn't remove adoption for ${repo}.`);
    }
  }

  return {
    applied, setApplied, proposed, setProposed, pick, setPick, prBusy, prResult, prError, confirmingPr, setConfirmingPr,
    markError, batchBusy, setBatchBusy, apply, openPr, unapply,
  };
}
