"use client";

// One company playbook (Direction #3.2): display + per-playbook "Copy for LLM" + remove, plus adoption
// — how many repos applied it and the average dimension lift since — and a control to mark/unmark repos
// as having applied it (the explicit adoption signal). Applied set is managed locally + synced to the
// API; lift is the server-computed historical metric (changes only after the next scan).

import { useState } from "react";
import { CopyForLlm } from "@/components/CopyForLlm";
import { playbookMarkdown } from "@/lib/org/playbook-brief";
import type { PlaybookAdoption, PlaybookRow } from "@/lib/db";

export function PlaybookCard({
  playbook: p,
  dimLabel,
  adoption,
  repoOptions,
  onRemove,
}: {
  playbook: PlaybookRow;
  dimLabel: string;
  adoption: PlaybookAdoption | undefined;
  repoOptions: string[];
  onRemove: () => void;
}) {
  const [applied, setApplied] = useState<string[]>(adoption?.appliedRepos ?? []);
  const [pick, setPick] = useState("");
  const lift = adoption?.lift ?? null;
  const available = repoOptions.filter((r) => !applied.includes(r));

  async function apply() {
    const repo = pick;
    if (!repo || applied.includes(repo)) return;
    setApplied((a) => [...a, repo]);
    setPick("");
    await fetch(`/api/org/playbooks/${p.id}/repos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo }),
    });
  }

  async function unapply(repo: string) {
    setApplied((a) => a.filter((r) => r !== repo));
    await fetch(`/api/org/playbooks/${p.id}/repos`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo }),
    });
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium text-white">{p.title}</span>
          <span className="ml-2 rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-400">
            {p.dimId} · {dimLabel}
          </span>
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
        <div className="mt-2 flex items-center gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200">
            <option value="">Mark a repo as applied…</option>
            {available.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button onClick={apply} disabled={!pick} className="shrink-0 rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50">
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
