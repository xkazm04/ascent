// What saving the draft would do, under both theme editors: the repos that turn red or green, the
// repos a new bar cannot judge, and the bars the draft removes, all BEFORE the write. Render-only (the
// preview state comes from usePolicyPreview), so no "use client" of its own.
//
// Deliberately not a live region: the editor's one polite status region announces save outcomes, and
// a second competing region would race it on every debounced keystroke.

import type { ImpactRepo } from "@/lib/org/gate-policy-impact";
import type { PreviewView } from "./policyPreviewModel";

const SHOWN = 5;

function RepoList({ label, repos, tone }: { label: string; repos: ImpactRepo[]; tone: string }) {
  if (repos.length === 0) return null;
  const rest = repos.length - SHOWN;
  return (
    <li className="type-body-sm text-slate-400">
      <span className={tone}>{label}</span>{" "}
      {repos.slice(0, SHOWN).map((r, i) => (
        <span key={r.fullName} title={r.reasons.join(" ")}>
          {i > 0 ? ", " : ""}
          {r.name} ({r.overall})
        </span>
      ))}
      {rest > 0 ? `, +${rest} more` : ""}
    </li>
  );
}

export function PolicyImpactStrip({ preview }: { preview: PreviewView }) {
  if (preview.status === "idle") return null;
  if (preview.status === "error" && !preview.data) {
    return (
      <div className="mt-3 type-body-sm text-slate-500" data-testid="policy-impact">
        Impact preview unavailable: {preview.error}
      </div>
    );
  }
  const d = preview.data;
  return (
    <div
      className={`mt-3 rounded-md border px-3 py-2 transition-opacity ${preview.tone === "warn" ? "border-orange-400/40" : "border-slate-700"} ${preview.dimmed ? "opacity-60" : ""}`}
      data-testid="policy-impact"
      aria-busy={preview.dimmed}
    >
      <div className="type-mono-sm uppercase tracking-widest text-slate-500">
        If you save this draft{preview.dimmed ? " (updating)" : ""}
      </div>
      {d ? (
        <>
          <p className="mt-1 type-body-sm text-slate-200">{preview.summary}</p>
          <ul className="mt-1 space-y-0.5">
            <RepoList label="Turns red:" repos={d.impact.newlyFailing} tone="text-orange-300" />
            <RepoList label="Turns green:" repos={d.impact.newlyPassing} tone="text-emerald-300" />
            {d.impact.removed.length > 0 ? (
              <li className="type-body-sm text-orange-300">
                Removes: {d.impact.removed.map((r) => `${r.label}${r.was ? ` (${r.was})` : ""}`).join("; ")}
              </li>
            ) : null}
          </ul>
        </>
      ) : (
        <p className="mt-1 type-body-sm text-slate-500">Checking the fleet against this draft.</p>
      )}
    </div>
  );
}
