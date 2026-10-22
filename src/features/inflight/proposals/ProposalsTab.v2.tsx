// The Prism composition of the Proposals tab. Same data and the same ledger behaviour as v1; what changes is
// the structure: a masthead that states what is waiting (open, handed off, from the loop, points on the
// table), then one ruled Frame holding the filters and the decision ledger, instead of a header and a card.
import Link from "next/link";
import { Frame, Masthead } from "@/components/kit";
import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { LocalRescanButton } from "@/components/org/followups/LocalRescanButton";
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { ProposalsWorklistV2 } from "./ProposalsWorklist.v2";
import type { ProposalsTabData } from "./proposalsTabData";

export function proposalsV2(d: ProposalsTabData) {
  const { slug, rows, counts } = d;
  return (
    <div className="stagger-children space-y-8">
      <Masthead
        eyebrow="In flight"
        statement="Proposed changes,"
        named="waiting on a decision."
        lede="Every gap the scans left open and every change a loop run armed, in one ledger."
        figures={[
          { label: "Open", value: counts.open },
          { label: "Handed off", value: counts.handedOff },
          { label: "From the loop", value: counts.loop },
          { label: "Points on the table", value: `+${counts.points}`, title: "Projected overall-score points if every open gap closes" },
        ]}
      />
      <ScopeFilterBar {...d.barProps} className="flex flex-wrap items-center justify-end gap-2" />
      {d.pairedRepos.length > 0 && <LocalRescanButton org={slug} repos={d.pairedRepos} />}
      <Frame aria-label="Proposals ledger">
        {rows.length === 0 ? (
          <p className="type-body text-slate-300">No proposals yet. Scan some repositories and their gaps land here; so does a loop run&apos;s unreviewed work.</p>
        ) : (
          <ProposalsWorklistV2 org={slug} rows={rows} initialDim={d.initialDim} canReview={d.canReview} viewer={d.viewer} />
        )}
      </Frame>
      <nav aria-label="Related views" className="flex justify-end">
        <Link href={orgTabHref(slug, "lessons")} className="focus-ring type-caption text-accent transition hover:text-white">
          Loop lessons →
        </Link>
      </nav>
      {rows.length > 0 && <NextMoveLink href={orgTabHref(slug, "live")} to="live" />}
    </div>
  );
}
