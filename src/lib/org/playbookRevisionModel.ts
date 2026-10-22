// playbooks-1: an edited playbook's standing across the fleet. PURE: no db, no clock, no I/O, so the
// GET route, the db reader and the client rollout all read the same table.
//
// A repo that adopted a playbook is in exactly one standing against the playbook's current version:
//   behind      adopted at an older version; its landed file is byte-tracked, so a revision may replace it
//   diverged    the landed file was hand-edited or removed. NEVER offered: the edit is the user's call,
//               the same rule the practices drift strip holds (and the write refuses it anyway, because
//               its digest no longer matches what Ascent landed)
//   unversioned the mark carries no version, or there is no ledger row (marked by hand, no file Ascent
//               landed). Listed, never preselected; revisable only with an adopted ledger digest
//   current     already on this version
//   in-flight   a PR is open: the first apply (`proposed`), or a revision drafted for this version

export type RevisionStanding = "behind" | "diverged" | "unversioned" | "current" | "in-flight";

/** The adoption-ledger fields the classification needs. */
export interface RevisionLedger {
  state: string;
  adoptedHash: string | null;
  /** The playbook version the row's last proposal carried (null on a first apply). */
  patternVersion?: number | null;
}

/** Same number as every other fleet write (practices / playbook apply-batch MAX_BATCH). */
export const MAX_REVISION_BATCH = 25;

export function classify(input: {
  playbookVersion: number;
  appliedVersion: number | null;
  ledger: RevisionLedger | null;
}): RevisionStanding {
  const { playbookVersion, appliedVersion, ledger } = input;
  if (ledger?.state === "proposed") return "in-flight";
  if (ledger?.state === "drifted" || ledger?.state === "removed") return "diverged";
  if (appliedVersion !== null && appliedVersion >= playbookVersion) return "current";
  if (!ledger) return "unversioned";
  if (ledger.state === "adopted" && ledger.patternVersion === playbookVersion) return "in-flight";
  if (appliedVersion === null) return "unversioned";
  return "behind";
}

/** A revision may target this repo: behind or unversioned, with the digest of the file that landed. */
export function isRevisable(standing: RevisionStanding, ledger: RevisionLedger | null): boolean {
  return (standing === "behind" || standing === "unversioned") && ledger?.state === "adopted" && Boolean(ledger.adoptedHash);
}

const PRIORITY: Record<string, number> = { proposed: 0, drifted: 1, removed: 2, adopted: 3 };

/** One repo can carry several ledger rows for a playbook (a plain re-apply after a title edit seeds a
 *  second path). Read the most conservative: an open PR, then any hand edit, then a clean adoption. */
export function pickLedgerRow<T extends { state: string }>(rows: readonly T[]): T | null {
  const live = rows.filter((r) => PRIORITY[r.state] !== undefined);
  live.sort((a, b) => PRIORITY[a.state]! - PRIORITY[b.state]!);
  return live[0] ?? null;
}

export interface RevisionSets {
  version: number;
  behind: { repo: string; appliedVersion: number }[];
  diverged: { repo: string; state: string }[];
  unversioned: { repo: string; appliedVersion: null; revisable: boolean }[];
  current: string[];
  inFlight: string[];
}

export function foldRevisionSets(
  version: number,
  entries: readonly { repo: string; appliedVersion: number | null; ledger: RevisionLedger | null }[],
): RevisionSets {
  const sets: RevisionSets = { version, behind: [], diverged: [], unversioned: [], current: [], inFlight: [] };
  for (const e of [...entries].sort((a, b) => a.repo.localeCompare(b.repo))) {
    const standing = classify({ playbookVersion: version, appliedVersion: e.appliedVersion, ledger: e.ledger });
    if (standing === "behind") sets.behind.push({ repo: e.repo, appliedVersion: e.appliedVersion! });
    else if (standing === "diverged") sets.diverged.push({ repo: e.repo, state: e.ledger!.state });
    else if (standing === "unversioned")
      sets.unversioned.push({ repo: e.repo, appliedVersion: null, revisable: isRevisable(standing, e.ledger) });
    else if (standing === "current") sets.current.push(e.repo);
    else sets.inFlight.push(e.repo);
  }
  return sets;
}

/** "N repos on v1-v2 -> update to v3": the rollout's one-line reading. */
export function revisionRolloutLine(sets: Pick<RevisionSets, "version" | "behind">): string {
  const n = sets.behind.length;
  if (n === 0) return `Every adopter is on v${sets.version}`;
  const vs = sets.behind.map((b) => b.appliedVersion);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = lo === hi ? `v${lo}` : `v${lo}-v${hi}`;
  return `${n} ${n === 1 ? "repo" : "repos"} on ${span} -> update to v${sets.version}`;
}

/** The typed confirm: the exact org slug, nothing looser. */
export function revisionConfirmReady(typed: string, org: string): boolean {
  return typed === org;
}

export function revisionConfirmCopy(org: string, repos: readonly string[], version: number): { title: string; body: string } {
  return {
    title: `Open ${repos.length} draft ${repos.length === 1 ? "PR" : "PRs"} in ${org}`,
    body:
      `Each PR updates the landed playbook file to v${version} in place: ${repos.join(", ")}. ` +
      `A file edited in the repo since it landed is refused, never overwritten. Type ${org} to confirm.`,
  };
}
