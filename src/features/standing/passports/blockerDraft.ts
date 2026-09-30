// The blocker → GitHub issue draft. Shared by both docket compositions so the title, the finding id
// and the per-repo footer cannot diverge.
import type { IssueDraft } from "@/components/github/CreateIssueModal";
import { reportPermalink } from "@/lib/ui";
import type { Agg } from "./passportBlockerAgg";

export function draftFor(a: Agg, org: string, scopeLabel: string, inView: number): IssueDraft {
  const origin = window.location.origin;
  return {
    title: a.label.replace(/\.$/, ""),
    findingId: `${a.axis === "automation" ? "auto" : "prod"}.${a.code}`,
    context: `${a.axis} blocker · ${a.repos.length}/${inView} repos in view`,
    body: [
      `Ascent flagged a **${a.axis} readiness** blocker on this repository:`,
      ``,
      `> ${a.label}`,
      ``,
      `It affects ${a.repos.length} of the ${inView} repos in the "${scopeLabel}" view of the [${org} fleet passports](${origin}/org/${org}/passports).`,
    ].join("\n"),
    targets: a.repos.map((r) => ({
      name: r.name,
      fullName: r.fullName,
      footer: `Ascent report for this repo: ${origin}${reportPermalink(r.fullName)}`,
    })),
  };
}
