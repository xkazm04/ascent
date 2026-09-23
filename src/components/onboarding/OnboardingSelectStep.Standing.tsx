import type { OrgRepo } from "@/components/onboarding/types";
import { isCovered, selectionMix, standingLabel } from "@/components/onboarding/repoStanding";

/**
 * first-run-onboarding-wizard#B: one row's standing in the org, beside its name. Rendered only when
 * the listing carries standing (the App path); a public-handle row has `standing` undefined and gets
 * no chip. Tone follows the decision it informs: a live, unchanged score is quiet (a rescan is a
 * refunded no-op), anything that still owes a live scan reads as work.
 */
export function StandingChip({ repo }: { repo: OrgRepo }) {
  if (repo.standing === undefined) return null;
  const label = standingLabel(repo.standing, repo.pushedAt);
  const settled = isCovered(repo.standing) && /unchanged/.test(label);
  return (
    <span
      data-standing={repo.standing == null || repo.standing.level == null ? "none" : repo.standing.preview ? "preview" : "scored"}
      className={`block truncate type-mono-sm ${settled ? "text-slate-500" : "text-slate-300"}`}
    >
      {label}
    </span>
  );
}

/** "N new · M rescans" beside the cap pill, so the selection reads as a coverage decision. Hidden
 *  when the listing carries no standing (the public-handle path) or nothing is selected. */
export function SelectionMix({ selected, repos }: { selected: ReadonlySet<string>; repos: readonly OrgRepo[] }) {
  const mix = selectionMix(selected, repos);
  if (!mix || selected.size === 0) return null;
  return (
    <span className="type-mono-sm tabular-nums text-slate-400" aria-live="polite">
      {mix.fresh} new · {mix.rescans} {mix.rescans === 1 ? "rescan" : "rescans"}
    </span>
  );
}
