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
//      starter for, that starter's file is not in the repo yet, AND the loop has never dispatched that
//      practice into this repo before → a PRACTICE lane. Dropping a starter is strictly cheaper than
//      an agent session, and the rescan adjudicates it the same way. Only the top item is considered:
//      the loop's ordering is impact-first, and letting any item in the batch pull the lane away from
//      the agent would make the template drop the default answer rather than the shortest path to the
//      biggest gap.
//
//      ONCE PER REPO, and the file test alone was not enough. The presence check reads a REMOVAL as an
//      omission: on `systedo-case` the loop installed the 18-line `ai-review.yml` starter, a later
//      lane's agent consolidated it into a 122-line `agent-review.yml` (plus a rubric, required-checks
//      and CODEOWNERS) and deleted the thin one, and the next run reinstalled the starter — forever,
//      never reaching a backlog or a craft lane. So the loop's OWN HISTORY is the second gate: a
//      practice a human or an agent removed is a standing decision, which the scoring prompt already
//      calls "context you were missing, not a reason to re-raise". Once every practice mapped to the
//      top item's dimension has been dispatched, this rule falls through to the ordinary ordering.
//   3. Otherwise, if there is NO open gap follow-up at all but the repo has unbuilt CRAFT rungs → a
//      CRAFT lane (r12). This is where the loop used to die: `openBatch` returned nothing at green,
//      no lane could arm, and a repository that had done everything the rubric asks got silence. A
//      craft lane is an ordinary agent lane with a different batch and a different brief; it moves no
//      score and adds no debt.
//   4. Otherwise → the ordinary BACKLOG lane. That stays the default and does everything else.
//
// NO HUMAN GATE ON THE CRAFT LANE, deliberately. It arms automatically exactly as a backlog lane
// does. The review that matters happens AFTER the work — the Storyboard's ✓/✕ ledger is a record of
// what was actually built, not a pre-approval queue — and a gate in front of unbounded work would
// simply stop the work. If a gate is ever wanted, THIS is the place to reintroduce it: return a
// proposal the curation screen must confirm before the engine may dispatch it, the same shape the
// practice lane's `itemId` already gives the operator something to prune.
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
  /**
   * The practice this proposal DECLINED to raise a second time — set only on the backlog fall-through
   * that rule 2's once-per-repo gate produces, `null` on every other outcome.
   *
   * It is carried out of the rule rather than logged inside it because this module is pure and is
   * called from a GET the operator may poll: the ENGINE turns it into a lesson, once per armed run,
   * so the operator can see WHY a lane that "should" install a starter did not.
   */
  skippedPracticeId: string | null;
}

export const BACKLOG_LANE: LaneKindProposal = {
  kind: "backlog",
  practiceId: null,
  itemId: null,
  reason: "Works this repo's open follow-ups with a local agent.",
  skippedPracticeId: null,
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
 *
 * `loadDispatchedPractices` is lazy for exactly the same reason and is read even later — only once a
 * practice-shaped gap has survived BOTH the dimension lookup and the file test. A foundation lane, an
 * all-craft batch, a dimension with no starter, and a repo that already carries the starter all answer
 * without it. It is REQUIRED rather than optional so the curation screen and the engine cannot
 * disagree: a caller that could omit it would be a second, more permissive rule, and the identity this
 * module's header states would hold only by convention.
 */
export async function proposeLaneKind(
  dir: string | null,
  loadItems: () => Promise<readonly FollowUpItem[]>,
  loadDispatchedPractices: () => Promise<ReadonlySet<string>>,
): Promise<LaneKindProposal> {
  if (!dir) return BACKLOG_LANE;
  try {
    if (!(await hasFoundation(dir))) {
      return {
        kind: "foundation",
        practiceId: null,
        itemId: null,
        reason: "No .ai/ foundation in this repo — this lane installs the generated standard, then rescans.",
        skippedPracticeId: null,
      };
    }
    const items = await loadItems();
    const top = items[0];
    // NO ITEMS AT ALL is the old dead end. `openBatch` already falls back to the craft ladder, so the
    // items in hand tell us which: an all-craft list means the repo has no open gap left, and the
    // lane should SAY so rather than arm as an unexplained "backlog" lane over craft work. The
    // proposal is read straight off the batch, so the curation screen and the engine cannot disagree
    // about what a lane is (the identity rule this module's header states).
    if (top && items.every((it) => it.kind === "craft")) {
      const axes = [...new Set(items.map((it) => it.craftAxis).filter((a): a is NonNullable<typeof a> => a != null))];
      return {
        kind: "craft",
        practiceId: null,
        itemId: null,
        reason: `No open gaps left — this lane works the craft ladder${axes.length ? ` (${axes.slice(0, 3).join(", ")})` : ""}, raising the ceiling rather than closing a gap.`,
        skippedPracticeId: null,
      };
    }
    if (!top) return BACKLOG_LANE;
    // `practiceForDimension` reads the SPINE (`PRACTICES`), which is 1:1 with the scored dimensions —
    // so "every practice for this dimension" is this one, and the dispatched-set test below is the
    // whole of the once-per-repo rule. If the spine ever stops being 1:1, this becomes a loop over the
    // dimension's practices that picks the first undispatched one.
    const practice = practiceForDimension(top.dimId);
    if (!practice) return BACKLOG_LANE;
    const path = practiceArtifactPath(practice.id);
    if (!path || (await exists(resolve(dir, path)))) return BACKLOG_LANE;
    // THE FILE IS ABSENT — which is not the same fact as "it was never installed". Read the loop's own
    // history last, and only here, so nothing above pays for it.
    if ((await loadDispatchedPractices()).has(practice.id)) {
      return {
        ...BACKLOG_LANE,
        skippedPracticeId: practice.id,
        reason: `${practice.label} was already installed here by an earlier lane and \`${path}\` is gone — a removal is a decision, not an omission, so this lane works the backlog instead.`,
      };
    }
    return {
      kind: "practice",
      practiceId: practice.id,
      itemId: top.id,
      reason: `${practice.label} — this lane installs \`${path}\`, the starter for the biggest open gap (${top.dimId}).`,
      skippedPracticeId: null,
    };
  } catch {
    return BACKLOG_LANE;
  }
}
