// Prism composition of the Care section: a ruled Frame per question (kept, wasted time, session bands,
// outcomes) instead of a stack under one border. NOTHING PER-PERSON CROSSES, as in v1: the aggregate is
// suppressed below the naming floor and the privacy ledger (the column of voids) still comes first.
import Link from "next/link";
import { Frame, SectionHead } from "@/components/kit";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { CareOrgView } from "@/lib/org/developer-view";
import { CareOrgAdoptionTiles, CareOrgAsks, CareOrgKeptMoves, CareOrgOutcomes, CareOrgSuppressed } from "./CareOrgAggregate";
import { CareOrgBands } from "./CareOrgBandStrips";
import { CarePrivacyLedger } from "./CarePrivacyLedger";

export function ContributorsCareSectionV2({ slug, org }: { slug: string; org: CareOrgView }) {
  return (
    <div data-role="care-v2" className="mt-8 space-y-2">
      <Frame aria-label="Care in this workspace">
        <SectionHead
          eyebrow="Care"
          title="Care in"
          named="this workspace."
          actions={
            <Link href={orgTabHref(slug, "developer")} className="focus-ring type-caption text-accent transition hover:text-white">
              Your own loop →
            </Link>
          }
        />
        <div className="mt-5">
          <CarePrivacyLedger org={org} />
          {org.belowFloor ? <CareOrgSuppressed org={org} /> : <CareOrgAdoptionTiles org={org} />}
        </div>
      </Frame>
      {org.belowFloor ? null : (
        <>
          <Frame pad="sm" aria-label="What people kept">
            <SectionHead eyebrow="Moves" title="What people" named="kept." level="named" as="h3" />
            <div className="mt-4">
              <CareOrgKeptMoves org={org} layout="rows" />
            </div>
          </Frame>
          <Frame pad="sm" aria-label="What people said wastes their time">
            <SectionHead eyebrow="Asks" title="What people said" named="wastes their time." level="named" as="h3" />
            <div className="mt-4">
              <CareOrgAsks org={org} />
            </div>
          </Frame>
          <Frame pad="sm" aria-label="How sessions look here">
            <SectionHead eyebrow="Sessions" title="How sessions" named="look here." level="named" as="h3" />
            <div className="mt-4">
              <CareOrgBands org={org} />
            </div>
          </Frame>
          <Frame pad="sm" aria-label="Did it move anything">
            <SectionHead eyebrow="Average repo score delta after a kept move" title="Did it" named="move anything." level="named" as="h3" />
            <div className="mt-4">
              <CareOrgOutcomes org={org} />
            </div>
          </Frame>
        </>
      )}
    </div>
  );
}
