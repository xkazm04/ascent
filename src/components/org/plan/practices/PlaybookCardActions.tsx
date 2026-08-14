"use client";

/**
 * The playbook card's apply controls — repo picker + "Mark applied" / "Open draft PR" (G6-15).
 *
 * Previously this whole block was gated on `available.length > 0` (repos NOT yet marked applied), so a
 * fully-adopted playbook lost every control at once and read as a dead card. Re-opening a draft PR for
 * an already-adopted repo is a legitimate action — the first PR may have been closed unmerged, or the
 * playbook may have been edited to a new version since. So the picker is now sourced from ALL
 * `repoOptions`, adopted repos are labelled as such, and the only thing that changes at 100% adoption
 * is that "Mark applied" has nothing left to mark (and says so).
 *
 * Extracted from PlaybookCard to keep that file under the 300-LOC cap.
 */
export function PlaybookApplyControls({
  repoOptions,
  applied,
  pick,
  onPick,
  onApply,
  onOpenPr,
  prBusy,
}: {
  /** Every repo this playbook may be applied to, adopted or not. */
  repoOptions: string[];
  applied: string[];
  pick: string;
  onPick: (repo: string) => void;
  onApply: () => void;
  onOpenPr: () => void;
  prBusy: boolean;
}) {
  const alreadyApplied = !!pick && applied.includes(pick);
  const remaining = repoOptions.filter((r) => !applied.includes(r)).length;

  // A genuinely empty scope is a different state from "all adopted" and must not be silent either.
  if (repoOptions.length === 0) {
    return (
      <p className="mt-2 font-mono text-sm text-slate-500">
        No repos in scope. Connect or select a repo to apply this playbook.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {/* aria-label: without it a screen reader announces this select only by its current option
            ("Pick a repo…") — every field in the sibling NewPracticeModal is labeled (playbooks #4). */}
        <select
          value={pick}
          onChange={(e) => onPick(e.target.value)}
          aria-label="Repo to apply this playbook to"
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200"
        >
          <option value="">Pick a repo…</option>
          {repoOptions.map((r) => (
            <option key={r} value={r}>
              {applied.includes(r) ? `${r} · adopted` : r}
            </option>
          ))}
        </select>
        <button
          onClick={onApply}
          disabled={!pick || alreadyApplied}
          className="focus-ring shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-accent hover:text-white disabled:opacity-50"
          title={
            alreadyApplied
              ? `${pick} is already marked as having adopted this playbook`
              : "Just record that this repo adopted the playbook"
          }
        >
          Mark applied
        </button>
        <button
          onClick={onOpenPr}
          disabled={!pick || prBusy}
          className="focus-ring shrink-0 rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
          title={
            alreadyApplied
              ? `Open another draft PR seeding this playbook into ${pick}`
              : "Open a draft PR seeding this playbook into the repo"
          }
        >
          {prBusy ? "Opening PR…" : "Open draft PR →"}
        </button>
      </div>
      {remaining === 0 && (
        // The former dead end, now explained: state the good news AND the action that remains.
        <p className="font-mono text-sm text-slate-500">
          All {repoOptions.length} repo{repoOptions.length === 1 ? "" : "s"} have adopted this playbook; pick one to
          re-open a draft PR, or unmark it above.
        </p>
      )}
    </div>
  );
}
