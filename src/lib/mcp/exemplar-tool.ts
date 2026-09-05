// `compare_against_exemplar` (moonshot #17 step 8) — the agent-door projection of #34's exemplar diff.
//
// THE SEAM THIS FILLS. `tools.ts` carried a stated seam here for one wave: the diff engine lives in
// `src/lib/report/exemplar.ts` (lane W2-J1) and had not merged, and a wrapper over a missing engine
// could only have returned a fabricated or empty diff — a tool that answers "here is how you compare
// to your best peer" with invented content is worse than a tool that is absent, because the agent
// cannot tell the difference. The engine landed; this is the wrapper, and it is a WRAPPER: every
// number comes from `diffAcrossRepos`, every resolution from `resolveExemplar`, and nothing here
// computes a comparison of its own. Two doors onto one diff must not be able to disagree.
//
// ── WHAT THIS FILE ADDS ON TOP OF J1'S CONTRACT ─────────────────────────────────────────────────
//
// 1. ORG FROM THE TOKEN, NEVER FROM AN ARGUMENT. `runTool` is handed `org` by the route, which took
//    it from the verified bearer token. There is no `org` input on this tool and there must never be
//    one: `resolveExemplar` gates `repo:` and `org:best` on exactly the slug it is given, so an org
//    argument would be a caller-supplied tenancy claim — the shape AGENTS.md forbids.
//
// 2. `cohort:` IS REFUSED FOR A PRIVATE SUBJECT. A cohort profile is built from the PUBLIC corpus,
//    across tenants. Placing a private repo beside it is not a leak of the cohort (the cohort is
//    aggregate-only, floored at 5 repos and 3 orgs) — it is a leak of the SUBJECT: the answer states
//    a private repo's per-dimension position within a public distribution, which is a measurement of
//    that repo published into a cross-tenant frame. J1's page never faced this because a private
//    repo's compare view is already org-gated to viewers who may read it; an API token is a
//    longer-lived, more copyable credential, so the door draws the line explicitly.
//
// 3. EVERY NON-`ok` RESOLUTION IS A SENTENCE. `not-found`, `forbidden`, `below-floor` and
//    `unavailable` each say what happened and what to do; none of them substitutes another exemplar.
//    A substituted comparison is undetectable to the caller, which is the whole reason J1's resolver
//    returns a discriminated union rather than a best-effort profile.

import { getOrgRollup, getScanComparison } from "@/lib/db";
import { DEFAULT_ORG_SLUG } from "@/lib/db/scans-shared";
import { diffAcrossRepos, exemplarRefLabel, parseExemplarRef, transferJoin } from "@/lib/report/exemplar";
import { isScanEligible, listExemplarOptions, loadSubjectFacets, resolveExemplar } from "@/lib/report/exemplar-load";
import { fail, str, type Args } from "@/lib/mcp/registry-reads";
import type { ToolResult } from "@/lib/mcp/handlers";

/** The accepted `against` grammar, quoted back on an unparseable ref rather than guessed at. */
const REF_FORMS =
  'Accepted forms: "owner/name" (a repo in this organization), "org:best" or "org:best:D3" (its ' +
  'strongest repo overall or on one dimension), "cohort:lang:TypeScript" or "cohort:archetype:team" ' +
  "(the public top decile for a slice).";

/**
 * What the caller could compare against, offered WITH a refusal rather than after it. An agent told
 * only "that is not a valid exemplar" retries with another guess; an agent handed the real options
 * picks one. Best-effort: a failed options read must not turn a stated refusal into an error.
 */
async function optionsFor(org: string, subjectFullName: string): Promise<string[]> {
  try {
    const facets = await loadSubjectFacets(org, subjectFullName);
    const options = await listExemplarOptions({ orgSlug: org, subjectFullName, ...facets });
    return options.map((o) => o.value);
  } catch {
    return [];
  }
}

/** One stated reason per non-`ok` resolution. No branch substitutes an exemplar. */
function refusalFor(kind: "not-found" | "forbidden" | "below-floor" | "unavailable", ref: string, extra: { population?: number; min?: number }): string {
  switch (kind) {
    case "not-found":
      return `No exemplar matched "${ref}" in this organization, or the repository it names has no scan that is eligible to be an exemplar (a mock-engine or old-rubric scan is a different instrument and cannot be one). Nothing was substituted.`;
    case "forbidden":
      return `"${ref}" cannot be an exemplar for this repository — a repository is not its own exemplar. Nothing was substituted.`;
    case "below-floor":
      return `The "${ref}" cohort has ${extra.population ?? 0} eligible public repositories, below the floor of ${extra.min ?? 0} this comparison requires. A smaller cohort would describe a handful of repositories rather than a population, and no broader slice was quietly used in its place.`;
    default:
      return `The exemplar could not be loaded right now. This is a temporary read failure, not a statement that "${ref}" does not exist — retry rather than concluding anything about the comparison.`;
  }
}

/**
 * Compare one of the org's repositories against a named exemplar, at the SIGNAL level.
 *
 * `org` is the token's org. `args` supplies only `repo` and `against`.
 */
export async function compareAgainstExemplar(org: string, args: Args): Promise<ToolResult> {
  const repoArg = str(args, "repo");
  const against = str(args, "against");
  if (!repoArg) return fail('Provide `repo` as "owner/name" — the repository you want compared.');
  if (!against) return fail(`Provide \`against\` — what to compare it to. ${REF_FORMS}`);

  const rollup = await getOrgRollup(org);
  if (!rollup) return fail(`No data for organization "${org}".`);
  const subjectRow = rollup.repos.find((r) => r.fullName.toLowerCase() === repoArg.toLowerCase());
  if (!subjectRow) return fail(`Repository "${repoArg}" is not in this organization's fleet.`);
  const subjectFullName = subjectRow.fullName;

  const ref = parseExemplarRef(against);
  if (!ref) {
    // NEVER a fallback exemplar. A comparison the caller did not ask for, returned where the one it
    // did ask for should be, is indistinguishable from the real answer.
    return fail(
      `"${against}" is not an exemplar this organization can resolve, and nothing was compared. ${REF_FORMS} Available here: ${(await optionsFor(org, subjectFullName)).join(", ") || "none — this organization has no other eligible scanned repository and no public cohort large enough."}`,
    );
  }

  // THE PRIVATE-SUBJECT RULE. Checked before any cohort read, so a private repo's scores are never
  // even placed beside the public distribution in memory.
  if (ref.kind === "cohort" && subjectRow.isPrivate) {
    return fail(
      `"${subjectFullName}" is a private repository, so it cannot be compared against a public cohort: the answer would state a private repository's position inside a cross-tenant distribution. Compare it against another repository in this organization ("owner/name") or against "org:best" instead.`,
    );
  }

  const comparison = await getScanComparison(subjectRow.owner, subjectRow.name, { orgSlug: org });
  const subject = comparison?.after ?? null;
  if (!subject) {
    return fail(
      `"${subjectFullName}" has no scan on record, so there is nothing to compare. Absence of a scan is not a score — it means this organization has never measured this repository.`,
    );
  }

  const resolution = await resolveExemplar(ref, { orgSlug: org, subjectFullName });
  if (resolution.kind !== "ok") {
    const population = resolution.kind === "below-floor" ? resolution.population : undefined;
    const min = resolution.kind === "below-floor" ? resolution.min : undefined;
    return fail(refusalFor(resolution.kind, exemplarRefLabel(ref), { population, min }));
  }

  const subjectEligible = await isScanEligible(subject.id);
  const diff = diffAcrossRepos(subject, resolution.profile, { subjectEligible });
  // House patterns are deliberately NOT mined here: `get_practice_shape` already serves this org's own
  // reusable shape, and a second producer of the same thing behind a different tool is how two answers
  // start to disagree. The join is asked for the practice-by-dimension mapping only.
  const linkSlug = org === DEFAULT_ORG_SLUG ? null : org;
  const transfers = transferJoin(diff, [], linkSlug);

  return {
    structuredContent: {
      subject: {
        repo: subjectFullName,
        scannedAt: diff.subject.scannedAt,
        overallScore: diff.subject.overallScore,
      },
      exemplar: diff.exemplar,
      overallGap: diff.overallGap,
      // A dimension only one side scored is NOT a gap of zero and not a gap at all — it is listed
      // separately so the agent can see what was excluded from every count below.
      notComparable: diff.notComparable,
      absentSignalCount: diff.absentSignalCount,
      aheadSignalCount: diff.aheadSignalCount,
      nothingToTransfer: diff.nothingToTransfer,
      dimensions: diff.dimensions.map((d) => ({
        id: d.id,
        name: d.name,
        subjectScore: d.subjectScore,
        exemplarScore: d.exemplarScore,
        scoreGap: d.scoreGap,
        comparable: d.comparable,
        absentSignals: d.absentSignals,
        aheadSignals: d.aheadSignals,
        transferLine: d.transferLine,
      })),
      // THE ACTIONABLE HALF: the concrete signals the exemplar has and this repo does not, joined to
      // the practice that carries each dimension.
      transfer: transfers.map((t) => ({
        dimension: t.dimId,
        absentSignals: t.absentSignals,
        practice: t.practice,
      })),
      basis: {
        ...diff.basis,
        note: diff.basis.subjectEligible
          ? "Both sides were scored by the same rubric, excluding mock-engine scans."
          : "This repository's own latest scan is NOT in the eligible set (a mock-engine or old-rubric run), so the two sides were produced by different instruments. The gaps below are indicative, not measured against a common bar.",
      },
      next: "Call get_practice_shape for the reusable shape of a practice named above, and find_skills for this organization's own skill that carries it.",
    },
  };
}
