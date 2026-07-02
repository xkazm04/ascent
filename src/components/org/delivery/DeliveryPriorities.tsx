// "Fix first" — the delivery tab's derived punch list. Turns the fleet's PR + governance aggregates
// into at most four concrete, evidence-backed actions (protect branches, require approvals, lift
// review coverage, govern AI PRs, shorten merges), each linking to the section or table that proves
// it. Deterministic server derivation — no LLM, no extra queries; it reads the data the page already
// fetched. Deliberately NOT a card grid: one list surface, severity carried by a labelled chip.

import { Surface } from "@/components/ui";
import { fmtHours } from "@/components/org/ui";
import type { OrgGovernance, OrgPrSignals } from "@/lib/db";

interface Priority {
  severity: "fix" | "improve";
  title: string;
  evidence: string;
  href: string;
  action: string;
}

const REVIEW_TARGET = 80; // % of human-merged PRs with an approving review
const SLOW_MERGE_HOURS = 48;

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
        evidence: `${nameFew(unprotected.map((r) => r.name))} — anyone with push access can commit straight to main.`,
        href: "#governance",
        action: "Review gaps",
      });
    }
    const zeroApproval = gov.perRepo.filter((r) => r.protected && r.requiredApprovals < 1);
    if (zeroApproval.length > 0) {
      out.push({
        severity: "fix",
        title: `Require an approving review on ${zeroApproval.length} protected repo${zeroApproval.length > 1 ? "s" : ""}`,
        evidence: `${nameFew(zeroApproval.map((r) => r.name))} — protection is on, but 0 approvals are required, so authors can self-merge unreviewed.`,
        href: "#governance",
        action: "Review gaps",
      });
    }
  }

  if (pr) {
    if (pr.avgReviewedRate != null && pr.avgReviewedRate < REVIEW_TARGET) {
      const worst = pr.perRepo.find((r) => r.reviewedRate != null);
      out.push({
        severity: "improve",
        title: "Lift human review coverage",
        evidence: `${pr.avgReviewedRate}% of human-merged PRs get an approving review (target ≥${REVIEW_TARGET}%)${
          worst ? ` — weakest: ${worst.name} at ${worst.reviewedRate}%` : ""
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
    if (pr.typicalHoursToMerge != null && pr.typicalHoursToMerge > SLOW_MERGE_HOURS) {
      out.push({
        severity: "improve",
        title: "Shorten time-to-merge",
        evidence: `A typical PR takes ${fmtHours(pr.typicalHoursToMerge)} to merge — the per-repo table below surfaces the slowest queues.`,
        href: "#per-repo",
        action: "See repos",
      });
    }
  }

  // fix before improve, original (impact) order within each band; cap so it stays a punch list.
  return [...out.filter((p) => p.severity === "fix"), ...out.filter((p) => p.severity === "improve")].slice(0, 4);
}

const CHIP: Record<Priority["severity"], string> = {
  fix: "border-warn/40 bg-warn/10 text-orange-300",
  improve: "border-accent/40 bg-accent/10 text-accent-soft",
};

export function DeliveryPriorities({ pr, gov }: { pr: OrgPrSignals | null; gov: OrgGovernance | null }) {
  const priorities = derivePriorities(pr, gov);

  if (priorities.length === 0) {
    return (
      <Surface radius="xl" className="flex items-center gap-3 px-4 py-3">
        <span aria-hidden className="text-lime-400">✓</span>
        <p className="text-sm text-slate-400">
          No delivery red flags — branch protection, review coverage, and merge flow all clear the bar.
        </p>
      </Surface>
    );
  }

  return (
    <Surface radius="xl">
      <div className="border-b border-divider px-4 py-2.5 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
        Fix first · {priorities.length} action{priorities.length > 1 ? "s" : ""} from this fleet&apos;s signals
      </div>
      <ul className="divide-y divide-divider">
        {priorities.map((p) => (
          <li key={p.title} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 sm:flex-nowrap">
            <span className={`shrink-0 self-center rounded border px-1.5 py-0.5 font-mono text-xs uppercase tracking-widest ${CHIP[p.severity]}`}>
              {p.severity === "fix" ? "fix now" : "improve"}
            </span>
            <div className="min-w-0 flex-1">
              <span className="font-medium text-white">{p.title}</span>
              <span className="ml-2 text-sm text-slate-400">{p.evidence}</span>
            </div>
            <a href={p.href} className="focus-ring shrink-0 self-center font-mono text-sm text-accent transition hover:text-white">
              {p.action} ↓
            </a>
          </li>
        ))}
      </ul>
    </Surface>
  );
}
