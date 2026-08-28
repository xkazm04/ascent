// WHICH KIND of lane a repo's next cycle should be — the one rule the curation screen and the engine
// both call.
//
// The identity matters exactly as much as it does for `openBatch`: a curation panel that computed
// "foundation" from one rule while the engine dispatched an agent from another would eventually show
// a proposal the run then declines to honour, and nobody would know which side was wrong. So there is
// one function, it reads the operator's own paired working copy, and both doors call it.
//
// THE RULE, in order:
//   1. No `.ai/` foundation in the repo → a FOUNDATION lane. This is the whole point of gap #5: the
//      generated standard was reachable only from the per-repo report header (a 7-hop detour in
//      Priya's L2 walk), so a local loop could iterate forever on a repo that had never been given
//      the contract an agent is supposed to read.
//   2. Otherwise, if the HIGHEST-IMPACT open follow-up sits on a dimension the Practice Library has a
//      starter for AND that starter's file is not in the repo yet → a PRACTICE lane. Dropping a
//      starter is strictly cheaper than an agent session, and the rescan adjudicates it the same way.
//      Only the top item is considered: the loop's ordering is impact-first, and letting any item in
//      the batch pull the lane away from the agent would make the template drop the default answer
//      rather than the shortest path to the biggest gap.
//   3. Otherwise → the ordinary BACKLOG lane. That stays the default and does everything else.
//
// LOCAL MODE ONLY. Every branch here reads a filesystem path, so on the managed cloud path (where
// `selfHosted()` is false and these routes 404) nothing changes: practices and the foundation keep
// going out as GitHub-App draft PRs.

import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { PRACTICES, type PracticeDef } from "@/lib/practices";
import { buildArtifact } from "@/lib/practice-artifact";
import type { FollowUpItem } from "@/lib/org/followups";
import type { LoopLaneKind } from "@/lib/db/loop-runs-types";

/** The manifest spine, in both spellings `src/lib/analyze/passport.ts:260` accepts. */
export const FOUNDATION_SPINES = [".ai/manifest.yaml", ".ai/manifest.yml"] as const;

export interface LaneKindProposal {
  kind: LoopLaneKind;
  /** Practice Library id — only on a `practice` proposal. */
  practiceId: string | null;
  /** The follow-up a `practice` lane answers; its commit carries this id's `Ascent-Resolves:` trailer. */
  itemId: string | null;
  /** One line for the curation panel and the lane log. Always set. */
  reason: string;
}

export const BACKLOG_LANE: LaneKindProposal = {
  kind: "backlog",
  practiceId: null,
  itemId: null,
  reason: "Works this repo's open follow-ups with a local agent.",
};

const exists = (abs: string): Promise<boolean> =>
  stat(abs).then(
    () => true,
    () => false,
  );

/** True when the repo already carries the `.ai/` manifest spine. */
export async function hasFoundation(dir: string): Promise<boolean> {
  for (const spine of FOUNDATION_SPINES) if (await exists(resolve(dir, spine))) return true;
  return false;
}

/** The Practice Library entry for a dimension — the same 1:1 map the report's ExemplarPointer uses. */
export function practiceForDimension(dimId: string): PracticeDef | null {
  return PRACTICES.find((p) => p.dimId === dimId) ?? null;
}

/**
 * The repo-relative path a practice's starter lands at.
 *
 * Read off the real generator rather than a second table, so a practice whose path moves cannot leave
 * this check pointing at the old one. `buildArtifact`'s path is a per-practice literal that does not
 * depend on the repo context, which is why a placeholder context is sound here — the BODY it also
 * builds is discarded.
 */
export function practiceArtifactPath(practiceId: string): string | null {
  return buildArtifact(practiceId, { fullName: "owner/repo", name: "repo" })?.path ?? null;
}

/**
 * The lane kind for one repo, given its paired working copy and its impact-ordered open follow-ups.
 *
 * `dir` null (no pairing) means nothing can be read, so nothing can be claimed: backlog. Every
 * filesystem read degrades the same way — a lane kind is a proposal, and the honest default when the
 * evidence is unreadable is the lane that was always there.
 *
 * `loadItems` is LAZY because rule 1 does not need it: a repo with no foundation is a foundation lane
 * whatever its backlog says, and making the engine read the backlog to discover that would put a
 * database round-trip per repo behind a filesystem question. Callers that already hold the items
 * (the curation route) pass `async () => items`.
 */
export async function proposeLaneKind(
  dir: string | null,
  loadItems: () => Promise<readonly FollowUpItem[]>,
): Promise<LaneKindProposal> {
  if (!dir) return BACKLOG_LANE;
  try {
    if (!(await hasFoundation(dir))) {
      return {
        kind: "foundation",
        practiceId: null,
        itemId: null,
        reason: "No .ai/ foundation in this repo — this lane installs the generated standard, then rescans.",
      };
    }
    const top = (await loadItems())[0];
    if (!top) return BACKLOG_LANE;
    const practice = practiceForDimension(top.dimId);
    if (!practice) return BACKLOG_LANE;
    const path = practiceArtifactPath(practice.id);
    if (!path || (await exists(resolve(dir, path)))) return BACKLOG_LANE;
    return {
      kind: "practice",
      practiceId: practice.id,
      itemId: top.id,
      reason: `${practice.label} — this lane installs \`${path}\`, the starter for the biggest open gap (${top.dimId}).`,
    };
  } catch {
    return BACKLOG_LANE;
  }
}
