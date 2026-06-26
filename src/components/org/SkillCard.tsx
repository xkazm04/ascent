"use client";

// One Org Skill (Feature 2): display + Copy for LLM / Download (both count as a "use", §8.7) + adoption
// (mark/unmark repos that reuse it, optimistic with rollback) + an admin-only Archive. Mirrors
// PlaybookCard. The skill body is rendered as plain preformatted text (never dangerouslySetInnerHTML),
// so user-authored markdown can't inject markup.

import { useState } from "react";
import { CopyForLlm } from "@/components/CopyForLlm";
import { skillCategoryLabel } from "@/lib/org/skill-categories";
import type { SkillAdoption, SkillRow } from "@/lib/db";

export function SkillCard({
  skill: s,
  slug,
  adoption,
  repoOptions,
  canArchive,
  onArchive,
}: {
  skill: SkillRow;
  slug: string;
  adoption: SkillAdoption | undefined;
  repoOptions: string[];
  canArchive: boolean;
  onArchive: () => void;
}) {
  const [applied, setApplied] = useState<string[]>(adoption?.adoptedRepos ?? []);
  const [pick, setPick] = useState("");
  const available = repoOptions.filter((r) => !applied.includes(r));

  // Count a "Copy for LLM" as a use (best-effort, fire-and-forget — never block the copy).
  function countCopy() {
    fetch(`/api/org/skills/${s.id}/download`, { method: "POST" }).catch(() => {});
  }

  async function adopt() {
    const repo = pick;
    if (!repo || applied.includes(repo)) return;
    setApplied((a) => [...a, repo]); // optimistic
    setPick("");
    // Roll back if the server didn't record it, so the card can't show adoption the DB lacks.
    try {
      const res = await fetch(`/api/org/skills/${s.id}/adopt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo }),
      });
      if (!res.ok) setApplied((a) => a.filter((r) => r !== repo));
    } catch {
      setApplied((a) => a.filter((r) => r !== repo));
    }
  }

  async function unadopt(repo: string) {
    setApplied((a) => a.filter((r) => r !== repo)); // optimistic
    try {
      const res = await fetch(`/api/org/skills/${s.id}/adopt`, {
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
          <span className="font-medium text-white">{s.name}</span>
          <span className="ml-2 rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-400">
            {skillCategoryLabel(s.category)}
          </span>
          {s.version > 1 && (
            <span className="ml-2 font-mono text-sm text-slate-500" title={`Last edited ${s.updatedAt.slice(0, 10)}`}>
              v{s.version}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CopyForLlm text={s.content} label="Copy" ariaLabel={`Copy "${s.name}" for LLM`} onCopied={countCopy} />
          <a
            href={`/api/org/skills/${s.id}/download`}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:border-accent hover:text-white"
            title="Download the skill as a SKILL.md file"
          >
            <span aria-hidden>↓</span> Download
          </a>
          {canArchive && (
            <button onClick={onArchive} className="font-mono text-sm text-slate-600 hover:text-orange-300" title="Archive this skill (admins only)">
              archive
            </button>
          )}
        </div>
      </div>
      {s.description && <p className="mt-1 text-base text-slate-400">{s.description}</p>}

      {s.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {s.tags.map((t) => (
            <span key={t} className="rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5 font-mono text-xs text-slate-400">
              #{t}
            </span>
          ))}
        </div>
      )}

      <details className="group mt-2">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-mono text-sm text-slate-500 transition hover:text-slate-300 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-slate-600 transition-transform group-open:rotate-90">›</span>
          Preview skill
        </summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs whitespace-pre-wrap text-slate-300">
          {s.content}
        </pre>
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-800 pt-3 text-sm">
        <span className="font-mono text-slate-400">
          Adopted by <span className="text-white">{applied.length}</span> repo{applied.length === 1 ? "" : "s"}
        </span>
        <span className="font-mono text-slate-500" title="Total downloads + copies">
          {s.downloadCount} use{s.downloadCount === 1 ? "" : "s"}
        </span>
      </div>

      {applied.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {applied.map((r) => (
            <span key={r} className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-sm text-slate-300">
              {r.split("/").pop()}
              <button onClick={() => unadopt(r)} className="text-slate-600 hover:text-orange-300" title={`Unmark ${r}`}>×</button>
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
          <button onClick={adopt} disabled={!pick} className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-accent hover:text-white disabled:opacity-50" title="Record that this repo adopted the skill">
            Mark adopted
          </button>
        </div>
      )}
    </div>
  );
}
