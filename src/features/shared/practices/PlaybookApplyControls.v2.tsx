"use client";

// Prism playbook apply. Same picker rules as Altimeter: every repo, adopted ones labeled, mark
// disabled once the pick is already applied. The select is a FormField.
import { FormField, GhostAction, PrimaryAction, Select } from "@/components/kit";

export function PlaybookApplyControlsV2({
  repoOptions,
  applied,
  pick,
  onPick,
  onApply,
  onOpenPr,
  prBusy,
}: {
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
  if (repoOptions.length === 0) {
    return <p className="mt-2 text-slate-400">No repos in scope. Connect or select a repo to apply this playbook.</p>;
  }
  const markTitle = alreadyApplied
    ? `${pick} is already marked as having adopted this playbook`
    : "Just record that this repo adopted the playbook";
  const prTitle = alreadyApplied
    ? `Open another draft PR seeding this playbook into ${pick}`
    : "Open a draft PR seeding this playbook into the repo";

  return (
    <div className="mt-3 space-y-2">
      <FormField label="Repo to apply this playbook to" htmlFor="playbook-apply-repo">
        <Select
          id="playbook-apply-repo"
          value={pick}
          aria-label="Repo to apply this playbook to"
          onChange={(e) => onPick(e.target.value)}
        >
          <option value="">Pick a repo…</option>
          {repoOptions.map((r) => (
            <option key={r} value={r}>
              {applied.includes(r) ? `${r} · adopted` : r}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="flex flex-wrap items-center gap-2">
        <span title={markTitle}>
          <GhostAction onClick={onApply} disabled={!pick || alreadyApplied}>
            Mark applied
          </GhostAction>
        </span>
        <span title={prTitle}>
          <PrimaryAction onClick={onOpenPr} disabled={!pick || prBusy}>
            {prBusy ? "Opening PR…" : "Open draft PR →"}
          </PrimaryAction>
        </span>
      </div>
      {remaining === 0 && (
        <p className="text-slate-400">
          All {repoOptions.length} repo{repoOptions.length === 1 ? "" : "s"} have adopted this playbook; pick one to
          re-open a draft PR, or unmark it above.
        </p>
      )}
    </div>
  );
}
