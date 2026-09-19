// Pure confirmation copy: no React, DOM, or client runtime dependencies.


export type ConfirmTone = "danger" | "default";


/** The copy + styling for one confirm prompt. The pure builders below return this; callers spread it
 *  straight into <ConfirmAction {...spec} …/>. */
export interface ConfirmSpec {
  title: string;
  /** What will happen and how many things it affects — never "Are you sure?". */
  body: string;
  confirmLabel: string;
  /** "danger" = irreversible data loss (red confirm); "default" = expensive/side-effectful (accent). */
  tone: ConfirmTone;
  kicker?: string;
}


// ── Pure copy builders — each states WHAT happens and HOW MANY things it affects ─────────────────────
// Kept here (not at the call sites) so the wording is one place and unit-testable without a DOM.

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);


/** Segment delete wipes the segment AND every RepoSegment tag row (which also feed the Overview filter
 *  and the comparison view). Name the segment; count the tags going with it. */
export function segmentDeleteConfirm(name: string, tagCount: number): ConfirmSpec {
  const tags = tagCount > 0 ? ` and removes its ${tagCount} repo ${plural(tagCount, "tag")}` : "";
  return {
    kicker: "Delete segment",
    title: `Delete the "${name}" segment?`,
    body: `This permanently deletes the segment${tags}. Those tags also drive the Overview filter and segment comparison. This can't be undone.`,
    confirmLabel: "Delete segment",
    tone: "danger",
  };
}


/** Opening a draft PR writes a real branch + commit into the CUSTOMER's repo and files a pull request —
 *  a side effect the repo owner sees, not a local change. Name the repo and say what's being seeded.
 *  tone "default" (accent, not red): recoverable — the PR can be closed — but never silent. Shared by
 *  the playbook card and the backlog row (both seed a starter file into one repo). */
export function draftPrConfirm(repo: string, seeds: string): ConfirmSpec {
  return {
    kicker: "Open draft PR",
    title: `Open a draft PR in ${repo}?`,
    body: `This writes a new branch and commit into ${repo} and opens a real draft pull request seeding ${seeds}. It's visible to the repo's owners: recoverable (you can close the PR), but not a local-only change.`,
    confirmLabel: "Open draft PR",
    tone: "default",
  };
}


/** The fleet batch fans "open draft PR" across many repos of ONE org in a single click. State how many
 *  PRs actually open (the server caps each batch at `cap` and keeps the neediest-first repos), and warn
 *  when the selection exceeds the cap so "23 selected → 25 cap" isn't read as full coverage. tone
 *  "default": each PR is closeable, but this is the most expensive button in the app — name the count. */
export function batchPrConfirm(selectedCount: number, cap: number, org: string): ConfirmSpec {
  const n = Math.min(selectedCount, cap);
  const over =
    selectedCount > cap
      ? ` Only the first ${cap} of ${selectedCount} selected open this run. The rest exceed the per-batch cap; re-run to open them.`
      : "";
  return {
    kicker: "Fleet rollout",
    title: `Open ${n} draft ${plural(n, "PR")} across ${n} ${org} ${plural(n, "repo", "repos")}?`,
    body: `This opens a real draft pull request in ${n} ${plural(n, "repository", "repositories")} under ${org}, each writing its own branch and commit. Each repo's starter content is generated for that repo at apply time; it is not individually previewed.${over} Every repo's owners see it: recoverable per PR, but ${n} at once.`,
    confirmLabel: `Open ${n} ${plural(n, "PR")}`,
    tone: "default",
  };
}


/** "Re-test" spends one slot from the org's weekly scan quota to re-score a repo against its latest
 *  commit. It's free when the repo is unchanged (a 304 serves the cached scan), but a moved repo runs —
 *  and bills — a full re-score, so one click can silently burn a slot. tone "default": recoverable but
 *  metered. Name the repo. */
export function retestConfirm(repo: string): ConfirmSpec {
  return {
    kicker: "Re-test",
    title: `Re-scan ${repo}?`,
    body: `This spends one slot from your weekly scan quota to re-score ${repo} against its latest commit. It's free if nothing changed since the last scan, but a moved repo runs (and bills) a full re-score.`,
    confirmLabel: "Re-scan now",
    tone: "default",
  };
}


/** Goal delete is a HARD delete: the goal and its achievement history (the recorded milestones and the
 *  date it was met) go with it — no soft-delete, no undo. tone "danger" (red): irreversible data loss.
 *  Name the goal. */
export function goalDeleteConfirm(label: string): ConfirmSpec {
  return {
    kicker: "Delete goal",
    title: `Delete the "${label}" goal?`,
    body: `This permanently deletes the goal and its achievement history: the milestones it recorded and the date it was met. This can't be undone.`,
    confirmLabel: "Delete goal",
    tone: "danger",
  };
}
