"use client";

// One company playbook (Direction #3.2): display + per-playbook "Copy for LLM" + remove, plus adoption
// — how many repos applied it and the average dimension lift since — and a control to mark/unmark repos
// as having applied it (the explicit adoption signal). Applied set is managed locally + synced to the
// API; lift is the server-computed historical metric (changes only after the next scan).

import { useState } from "react";
import { CopyForLlm } from "@/components/CopyForLlm";
import { playbookMarkdown, playbookStarterFile } from "@/lib/org/playbook-brief";
import type { PlaybookAdoption, PlaybookRow } from "@/lib/db";

export function PlaybookCard({
  playbook: p,
  slug,
  dimLabel,
  adoption,
  repoOptions,
  onRemove,
}: {
  playbook: PlaybookRow;
  slug: string;
  dimLabel: string;
  adoption: PlaybookAdoption | undefined;
  repoOptions: string[];
  onRemove: () => void;
}) {
  const [applied, setApplied] = useState<string[]>(adoption?.appliedRepos ?? []);
  const [pick, setPick] = useState("");
  const [prBusy, setPrBusy] = useState(false);
  const [prResult, setPrResult] = useState<{ url: string; reused: boolean } | null>(null);
  const [prError, setPrError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [tracked, setTracked] = useState(false);

  // PLAY-5: turn a playbook's rollout into a tracked Initiative scoped to the repos that adopted it.
  async function trackAsInitiative() {
    if (tracking || tracked || applied.length === 0) return;
    setTracking(true);
    try {
      const res = await fetch("/api/org/initiatives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, title: `Roll out: ${p.title}`, dimId: p.dimId, repos: applied, playbookId: p.id }),
      });
      if (res.ok) setTracked(true);
    } catch {
      /* leave the button enabled to retry */
    } finally {
      setTracking(false);
    }
  }
  const lift = adoption?.lift ?? null;
  const available = repoOptions.filter((r) => !applied.includes(r));

  async function apply() {
    const repo = pick;
    if (!repo || applied.includes(repo)) return;
    setApplied((a) => [...a, repo]); // optimistic
    setPick("");
    // Roll the optimistic add back if the server didn't record it — otherwise the card shows the repo
    // as adopted while the DB has no row, seeding phantom Initiatives + skewed lift analytics.
    try {
      const res = await fetch(`/api/org/playbooks/${p.id}/repos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo }),
      });
      if (!res.ok) setApplied((a) => a.filter((r) => r !== repo));
    } catch {
      setApplied((a) => a.filter((r) => r !== repo));
    }
  }

  // Open a draft PR seeding the playbook into the picked repo (the route records adoption too).
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to open PR.");
      setPrResult({ url: data.url, reused: data.reused });
      setApplied((a) => (a.includes(repo) ? a : [...a, repo]));
      setPick("");
    } catch (e) {
      setPrError(e instanceof Error ? e.message : "Failed to open PR.");
    } finally {
      setPrBusy(false);
    }
  }

  async function unapply(repo: string) {
    setApplied((a) => a.filter((r) => r !== repo)); // optimistic
    // Re-add on failure so the card can't show a repo as un-adopted while the DB still has the row.
    try {
      const res = await fetch(`/api/org/playbooks/${p.id}/repos`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo }),
      });
      if (!res.ok) setApplied((a) => (a.includes(repo) ? a : [...a, repo]));
    } catch {
      setApplied((a) => (a.includes(repo) ? a : [...a, repo]));
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium text-white">{p.title}</span>
          <span className="ml-2 rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-400">
            {p.dimId} · {dimLabel}
          </span>
          {p.version > 1 && (
            <span className="ml-2 font-mono text-sm text-slate-500" title={`Last edited ${p.updatedAt.slice(0, 10)}`}>
              v{p.version}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CopyForLlm text={playbookMarkdown(p, dimLabel)} label="Copy" />
          <button onClick={onRemove} className="font-mono text-sm text-slate-600 hover:text-orange-300">remove</button>
        </div>
      </div>
      {p.summary && <p className="mt-1 text-base text-slate-400">{p.summary}</p>}
      {p.steps.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-slate-300">
          {p.steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="select-none text-slate-600">·</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}

      {/* PRAC-5: preview the exact docs/playbooks/<slug>.md the "Open draft PR" action commits. */}
      <details className="group mt-2">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-mono text-sm text-slate-500 transition hover:text-slate-300 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-slate-600 transition-transform group-open:rotate-90">›</span>
          Preview starter file
        </summary>
        <pre className="mt-2 max-h-60 overflow-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs whitespace-pre-wrap text-slate-300">
          {playbookStarterFile(p, dimLabel)}
        </pre>
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-800 pt-3 text-sm">
        <span className="font-mono text-slate-400">
          Adopted by <span className="text-white">{applied.length}</span> repo{applied.length === 1 ? "" : "s"}
        </span>
        {lift != null && (
          <span className="font-mono" style={{ color: lift >= 0 ? "#84cc16" : "#f97316" }} title={`Average ${p.dimId} change in applied repos since they applied this playbook`}>
            {lift >= 0 ? "▲ +" : "▼ "}
            {lift} avg {p.dimId} since
          </span>
        )}
        {applied.length > 0 &&
          (tracked ? (
            <span className="font-mono text-sm text-emerald-300" title="Track this rollout on the Plan tab">✓ Tracked as initiative</span>
          ) : (
            <button
              onClick={trackAsInitiative}
              disabled={tracking}
              className="font-mono text-sm text-accent hover:text-white disabled:opacity-50"
              title="Track this playbook's rollout as an initiative on the Plan tab"
            >
              {tracking ? "Tracking…" : "Track as initiative →"}
            </button>
          ))}
      </div>

      {applied.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {applied.map((r) => (
            <span key={r} className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-sm text-slate-300">
              {r.split("/").pop()}
              <button onClick={() => unapply(r)} className="text-slate-600 hover:text-orange-300" title={`Unmark ${r}`}>×</button>
            </span>
          ))}
        </div>
      )}

      {available.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200">
            <option value="">Pick a repo…</option>
            {available.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button onClick={apply} disabled={!pick} className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-accent hover:text-white disabled:opacity-50" title="Just record that this repo adopted the playbook">
            Mark applied
          </button>
          <button onClick={openPr} disabled={!pick || prBusy} className="shrink-0 rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50" title="Open a draft PR seeding this playbook into the repo">
            {prBusy ? "Opening PR…" : "Open draft PR →"}
          </button>
        </div>
      )}
      {prError && <p className="mt-2 text-sm text-orange-300">{prError}</p>}
      {prResult && (
        <p className="mt-2 text-sm text-emerald-300">
          {prResult.reused ? "Existing draft PR: " : "Draft PR opened: "}
          <a href={prResult.url} target="_blank" rel="noreferrer" className="underline hover:text-white">
            {prResult.url}
          </a>
        </p>
      )}
    </div>
  );
}
