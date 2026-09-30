// Failing repos, worst first, as ruled repo rows. The score stays paper: the miss is the reason
// text, not a red number.
import Link from "next/link";
import { Frame, HairlineList, RepoRow, SectionHead } from "@/components/kit";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { GovernanceOverview } from "@/lib/org/governance";

export function GovernanceFailuresV2({ slug, g }: { slug: string; g: GovernanceOverview }) {
  return (
    <Frame aria-label="Failing repos">
      <SectionHead eyebrow="Repos" title="Failing repos," named="worst first." />
      {g.failures.length === 0 ? (
        <p className="mt-4 type-body text-slate-300">No repos fail the gate.</p>
      ) : (
        <HairlineList className="mt-4">
          {g.failures.map((f) => (
            <RepoRow
              key={f.fullName}
              name={f.fullName}
              level={f.level}
              score={f.overall}
              scoreLabel="Overall score"
              stack={
                <span className="text-slate-400">
                  {f.reasons.map((reason, i) => (
                    <span key={i} className="mr-3">
                      <span aria-hidden>▲ </span>
                      {reason}
                    </span>
                  ))}
                </span>
              }
            />
          ))}
        </HairlineList>
      )}
      {g.failing > g.failures.length && (
        <p className="mt-3 type-body-sm text-slate-400">
          Showing the worst {g.failures.length} of {g.failing} failing repos. See the{" "}
          <Link href={orgTabHref(slug, "repositories")} className="text-accent hover:text-white">
            Repositories
          </Link>{" "}
          tab for the full list.
        </p>
      )}
    </Frame>
  );
}
