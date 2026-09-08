// The Contributors tab's footnotes — what was left OUT of the numbers above, and where the sibling
// rollup lives. Extracted from ContributorsInsightsPanel so that file stays under the 200-LOC cap.
//
// Both were paragraphs. The staleness note keeps its COUNT (that is data — repos genuinely excluded)
// and demotes its explanation to a WhyChip; the roadmap inventory it used to trail moved to the
// feature doc, where a list of things that do not exist yet belongs. Server-safe.

import { Kicker } from "@/components/ui";
import { StateSwatch, WhyChip, stateTitle } from "@/components/org/viz";
import { orgTabHref } from "@/lib/org/orgTabs";

const STALE_HINT =
  "Each repo's contributor snapshot is anchored to that repo's own last scan, so a long-unscanned repo " +
  "would otherwise blend a year-old activity window with yesterday's at equal weight. Rescan to include it.";

export function ContributorsNotes({ slug, staleRepos }: { slug: string; staleRepos: number }) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      {staleRepos > 0 ? (
        <span className="inline-flex items-center gap-2" title={stateTitle("missing", "excluded repositories")}>
          <StateSwatch state="missing" />
          <Kicker tone="muted" as="span">
            {staleRepos} {staleRepos === 1 ? "repo" : "repos"} excluded · snapshot too old
          </Kicker>
          <WhyChip hint={STALE_HINT} label="excluded repositories" />
        </span>
      ) : (
        <span />
      )}
      <a
        href={orgTabHref(slug, "teams")}
        className="focus-ring rounded-md px-2 py-1 type-mono-sm uppercase tracking-widest text-slate-500 transition-colors hover:text-accent"
      >
        Team rollups (CODEOWNERS) →
      </a>
    </div>
  );
}
