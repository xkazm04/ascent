// The "Fix first" DERIVATION — the delivery tab's punch list, as pure data.
//
// Split out of DeliveryPriorities.tsx (AGENTS.md: 200 LOC under src/features) so the branch logic is
// unit-testable without rendering, which the old `derivePriorities` export comment promised and no
// test ever delivered.

import { fmtHours } from "@/components/org/shared/ui";
import { REVIEW_TARGET } from "./PrSignalsBand";
import type { OrgGovernance, OrgPrSignals } from "@/lib/db";

export interface Priority {
  severity: "fix" | "improve";
  title: string;
  evidence: string;
  href: string;
  action: string;
}

const SLOW_MERGE_HOURS = 48;
/** A PR waiting a full working day for its FIRST review is the review-capacity ceiling showing —
 *  the universally named Assist→Delegate bottleneck (W1a review-capacity signal). */
const SLOW_FIRST_REVIEW_HOURS = 24;
/** Fleet revert share above this reads as rework eating delivery, not noise. */
const REVERT_ALERT_RATE = 5;
/**
 * The sample a repo needs before it may be NAMED as the fleet's worst reverter. `revertRate` is the
 * one PR rate the analyzer publishes with no minimum-sample floor (pulls.ts: `pct(revert, analyzed)`,
 * where its five siblings gate on `>= 5`), so a 2-PR repo with one revert scores 50% and used to win
 * this "worst" comparison outright — the loudest, least-supported sentence on the tab. The right fix
 * is the floor in the analyzer, which needs `PrStats.revertRate` widened to `number | null` in
 * src/lib/types.ts; until that lands, the floor is enforced here, against the denominator the
 * producer already persists per repo (`PrRepoRow.population.revert` = analyzed PRs).
 */
const REVERT_MIN_SAMPLE = 5;

function nameFew(names: string[], max = 3): string {
  const head = names.slice(0, max).join(", ");
  return names.length > max ? `${head} +${names.length - max} more` : head;
}

/** Derive the ranked priority list. Exported for the page to test emptiness (renders nothing vs. all-clear). */
export function derivePriorities(pr: OrgPrSignals | null, gov: OrgGovernance | null): Priority[] {
  const out: Priority[] = [];

  if (gov) {
    const unprotected = gov.perRepo.filter((r) => !r.protected);
    if (unprotected.length > 0) {
      out.push({
        severity: "fix",
        title: `Protect ${unprotected.length} default branch${unprotected.length > 1 ? "es" : ""}`,
        evidence: `${nameFew(unprotected.map((r) => r.name))}: anyone with push access can commit straight to main.`,
        href: "#governance",
        action: "Review gaps",
      });
    }
    const zeroApproval = gov.perRepo.filter((r) => r.protected && r.requiredApprovals < 1);
    if (zeroApproval.length > 0) {
      out.push({
        severity: "fix",
        title: `Require an approving review on ${zeroApproval.length} protected repo${zeroApproval.length > 1 ? "s" : ""}`,
        evidence: `${nameFew(zeroApproval.map((r) => r.name))}: protection is on, but 0 approvals are required, so authors can self-merge unreviewed.`,
        href: "#governance",
        action: "Review gaps",
      });
    }
  }

  if (pr) {
    // `pr.perRepo` arrives RISKIEST FIRST (getOrgPrSignals sorts: lowest review coverage, then
    // slowest merges), which is why the `find` below is allowed to take the first measured row and
    // call it the weakest. If that sort ever changes, this line silently starts naming an arbitrary
    // repo — the producer's sort is load-bearing here, not incidental.
    if (pr.avgReviewedRate != null && pr.avgReviewedRate < REVIEW_TARGET) {
      const worst = pr.perRepo.find((r) => r.reviewedRate != null);
      out.push({
        severity: "improve",
        title: "Lift human review coverage",
        evidence: `${pr.avgReviewedRate}% of human-merged PRs get an approving review (target ≥${REVIEW_TARGET}%)${
          worst ? `, weakest: ${worst.name} at ${worst.reviewedRate}%` : ""
        }.`,
        href: "#per-repo",
        action: "See repos",
      });
    }
    if (pr.avgAiInvolvedRate >= 10 && pr.avgAiGovernedRate != null && pr.avgAiGovernedRate < REVIEW_TARGET) {
      out.push({
        severity: "improve",
        title: "Put AI-assisted PRs under human review",
        evidence: `${pr.avgAiInvolvedRate}% of PRs are AI-involved, but only ${pr.avgAiGovernedRate}% of those get an approving review.`,
        href: "#per-repo",
        action: "See repos",
      });
    }
    // W1a review-capacity read: slow first review WHILE AI is scaling PR volume is the named
    // Assist→Delegate bottleneck — review capacity, not authoring, is what caps delegation.
    if (pr.typicalHoursToFirstReview != null && pr.typicalHoursToFirstReview > SLOW_FIRST_REVIEW_HOURS) {
      const aiPressure = pr.avgAiInvolvedRate >= 10;
      out.push({
        severity: "improve",
        title: "Unblock the review queue",
        evidence: `A typical PR waits ${fmtHours(pr.typicalHoursToFirstReview)} for its first review${
          aiPressure ? ` while ${pr.avgAiInvolvedRate}% of PRs are AI-involved; review capacity, not authoring, is the bottleneck to delegating more` : ""
        }.`,
        href: "#per-repo",
        action: "See repos",
      });
    }
    if (pr.avgRevertRate != null && pr.avgRevertRate >= REVERT_ALERT_RATE) {
      // Only repos with a real sample may be named. A repo whose denominator the scan never persisted
      // is also excluded: unknown sample size is not a passed floor.
      const worst = pr.perRepo.reduce<(typeof pr.perRepo)[number] | null>((acc, r) => {
        const pop = r.population.revert;
        if (r.revertRate == null || pop == null || pop < REVERT_MIN_SAMPLE) return acc;
        return acc?.revertRate == null || r.revertRate > acc.revertRate ? r : acc;
      }, null);
      out.push({
        severity: "improve",
        title: "Stabilize what ships",
        evidence: `${pr.avgRevertRate}% of PRs are reverts: shipped work coming back out${
          worst?.revertRate != null ? ` (worst: ${worst.name} at ${worst.revertRate}%)` : ""
        }.`,
        href: "#per-repo",
        action: "See repos",
      });
    }
    if (pr.typicalHoursToMerge != null && pr.typicalHoursToMerge > SLOW_MERGE_HOURS) {
      out.push({
        severity: "improve",
        title: "Shorten time-to-merge",
        evidence: `A typical PR takes ${fmtHours(pr.typicalHoursToMerge)} to merge. The per-repo table below surfaces the slowest queues.`,
        href: "#per-repo",
        action: "See repos",
      });
    }
  }

  // fix before improve, original (impact) order within each band; cap so it stays a punch list.
  return [...out.filter((p) => p.severity === "fix"), ...out.filter((p) => p.severity === "improve")].slice(0, 4);
}

