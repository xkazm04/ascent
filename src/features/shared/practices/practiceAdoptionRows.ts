// MOONSHOT #33 — the drift strip's view model. PURE (no JSX, no hooks, no fetch).
//
// The fold lives here rather than in PracticesTab because that file is a 121-LOC server orchestrator
// and the 200-LOC cap under src/features/** is what keeps it one. Same split as practiceRows.ts.

import type { PracticeAdoptionSummary } from "@/lib/db/practice-adoption";

export type AdoptionBucket = "adopted" | "behind" | "drifted";

export interface AdoptionTile {
  bucket: AdoptionBucket;
  label: string;
  value: number;
  sub: string;
  /** A rollout is offered only for a non-empty, actionable bucket. `adopted` never offers one. */
  rollout: { mode: "behind" | "drifted"; practiceId: string } | null;
}

/**
 * True when the ledger has anything to say. An org that has never applied a practice renders NO strip
 * at all rather than a row of confident zeros — the rule `rolloutIsMeaningful` already sets for the
 * lift strip directly above it, and the reason is the same: three zeros read as a measured verdict.
 */
export function adoptionIsMeaningful(s: PracticeAdoptionSummary): boolean {
  return s.total > 0;
}

/** `n on v1 · house pattern is v3`, or an honest absence. */
function behindSub(s: PracticeAdoptionSummary): string {
  if (s.behindRepos === 0) return "every adoption is on the current pattern";
  const g = s.widestGap;
  if (!g) return "on an older house pattern";
  return `on v${g.fromVersion} · house pattern is v${g.toVersion}`;
}

/**
 * Fold the summary into the strip's three tiles.
 *
 * A rollout is offered ONLY where there is something to roll out AND a practice to roll out — the
 * `widestGap` names it for `behind`. Drift has no single practice to name (a repo can drift on several
 * at once), so its action is offered per practice from the ledger table, not from the tile: the tile
 * states the count and the strip links to the worklist where each row is DECIDED. That asymmetry is
 * deliberate — "roll this back out" is a reasonable one-click answer to a version gap and a bad one to
 * a divergence somebody may have made on purpose.
 */
export function buildAdoptionTiles(s: PracticeAdoptionSummary): AdoptionTile[] {
  return [
    {
      bucket: "adopted",
      label: "Adopted",
      value: s.adoptedRepos,
      sub: s.adoptedRepos === 1 ? "repo carries a landed artifact" : "repos carry a landed artifact",
      rollout: null,
    },
    {
      bucket: "behind",
      label: "Behind",
      value: s.behindRepos,
      sub: behindSub(s),
      rollout:
        s.behindRepos > 0 && s.widestGap
          ? { mode: "behind", practiceId: s.widestGap.practiceId }
          : null,
    },
    {
      bucket: "drifted",
      label: "Drifted / removed",
      value: s.driftedRepos,
      sub:
        s.driftedRepos === 0
          ? "nothing has diverged since it landed"
          : s.driftedRepos === 1
            ? "repo to decide about"
            : "repos to decide about",
      rollout: null,
    },
  ];
}

/**
 * Append the EXACT repos and the practice to `batchPrConfirm`'s generic copy.
 *
 * The shared confirm names a count and an org; it cannot name what is being rolled out or where. A
 * confirm that says "12 repos" without saying WHICH is a confirm the user cannot actually check, so the
 * list is spelled out (bounded, with the remainder counted rather than elided silently).
 */
export function rolloutConfirmBody(base: string, practiceId: string, repos: readonly string[], show = 12): string {
  const listed = repos.slice(0, show).join(", ");
  const rest = repos.length > show ? ` …and ${repos.length - show} more` : "";
  return `${base}\n\nRolling out "${practiceId}" to: ${listed}${rest}.`;
}

/** Per-practice counts for the ledger table's adoption column. Undefined when the practice has none —
 *  an absent column cell is honest; a "0/0/0" would assert the practice was measured and found empty. */
export function adoptionFor(
  s: PracticeAdoptionSummary,
  practiceId: string,
): { adopted: number; behind: number; drifted: number } | undefined {
  return s.perPractice[practiceId];
}
