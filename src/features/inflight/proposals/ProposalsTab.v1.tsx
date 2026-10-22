// The Altimeter composition of the Proposals tab: the former ProposalsTab markup, moved here unchanged.
import Link from "next/link";
import { SectionEmpty, SectionHeader } from "@/components/shared/dashboard/ui";
import { ScopeFilterBar } from "@/components/shared/scope/ScopeFilterBar";
import { LocalRescanButton } from "@/components/shared/followups/LocalRescanButton";
import { NextMoveLink } from "@/components/shared/dashboard/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { ProposalsWorklist } from "./ProposalsWorklist";
import type { ProposalsTabData } from "./proposalsTabData";

export function proposalsV1(d: ProposalsTabData) {
  const { slug, rows, counts } = d;
  return (
    <div className="stagger-children space-y-5">
      <SectionHeader
        title="Proposals"
        description="Every proposed change waiting on a decision, in one ledger."
        right={
          <span className="type-mono-sm text-slate-400">
            <span className="tabular-nums text-slate-100">{counts.open}</span> open ·{" "}
            <span className="tabular-nums text-accent">{counts.handedOff}</span> handed off ·{" "}
            <span className="tabular-nums text-slate-100">{counts.loop}</span> from the loop ·{" "}
            <span className="tabular-nums text-white">+{counts.points}</span> pts on the table
          </span>
        }
      />
      <ScopeFilterBar {...d.barProps} className="flex flex-wrap items-center justify-end gap-2" />
      {d.pairedRepos.length > 0 && <LocalRescanButton org={slug} repos={d.pairedRepos} />}

      {rows.length === 0 ? (
        <SectionEmpty>No proposals yet. Scan some repositories and their gaps land here; so does a loop run&apos;s unreviewed work.</SectionEmpty>
      ) : (
        <ProposalsWorklist org={slug} rows={rows} initialDim={d.initialDim} canReview={d.canReview} viewer={d.viewer} />
      )}
      {/* A second route to the same stage's loop-lesson ledger; the next move below stays alone. */}
      <nav aria-label="Related views" className="flex justify-end">
        <Link href={orgTabHref(slug, "lessons")} className="focus-ring type-caption text-accent transition hover:text-white">
          Loop lessons →
        </Link>
      </nav>
      {rows.length > 0 && <NextMoveLink href={orgTabHref(slug, "live")} to="live" />}
    </div>
  );
}
