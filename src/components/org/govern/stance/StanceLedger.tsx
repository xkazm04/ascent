// VARIANT C — "The Ledger".
//
// Metaphor: the stance is a VERSIONED CONTRACT and the fleet is its ledger of obligations. The other
// two variants present the policy as it stands today; this one makes TIME the organising axis — the
// amendment history down the left, clause-by-clause adoption in the middle, and a sortable per-repo
// ledger where every row is a repo's standing against the current revision. The thesis: a stance is
// worthless the moment it is published and forgotten, so the surface's job is to show DRIFT — which
// repos are still operating under v1.2, which clauses the fleet quietly does not honour, and what the
// last amendment actually cost. Copy voice is contractual, numbers are the argument.

import { Kicker } from "@/components/ui";
import { SectionHeader, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import type { AiStanceDoc } from "./stanceMock";
import { StancePublishCta } from "./stanceShared";
import { ClauseAdoption, ComplianceLedger, ContractHeader, VersionTimeline } from "./ledgerParts";

export function StanceLedger({ doc, slug }: { doc: AiStanceDoc; slug: string }) {
  if (!doc.published) {
    return (
      <StancePublishCta
        kicker={`${slug} · ledger empty`}
        title="No stance on record, so nothing to hold a repo to."
        body="A stance only pays off when it is versioned and checked: published once, amended as the fleet learns, and reconciled against every repo on every scan. Open the ledger with a first revision and each amendment after it becomes measurable."
        cta="Publish v1.0"
        bullets={[
          { label: "Revision", text: "Every amendment dated, authored, and diffable." },
          { label: "Clauses", text: "Tools, zones, tiers and provenance as checkable obligations." },
          { label: "Ledger", text: "One row per repo against the current revision." },
          { label: "Drift", text: "Who is still operating under an older version." },
        ]}
      />
    );
  }

  const lagging = doc.repos.filter((r) => r.ack !== "current").length;
  const breaches = doc.repos.reduce((a, r) => a + r.violations, 0);
  const avgCompliance = doc.repos.length
    ? Math.round(doc.repos.reduce((a, r) => a + r.compliance, 0) / doc.repos.length)
    : 0;
  const worst = [...doc.repos].sort((a, b) => a.compliance - b.compliance)[0];

  return (
    <div className="space-y-6">
      <SectionHeader
        descriptionClassName="max-w-3xl"
        title="AI stance ledger"
        description="The org's AI stance as a versioned contract, reconciled against every scanned repo. The bar changes over time — this is the record of who has kept up with it and who has not."
        right={
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
            {doc.history.length} revisions · since {doc.history[doc.history.length - 1]?.date ?? doc.effective}
          </span>
        }
      />

      <ContractHeader doc={doc} />

      <div className={TILE_GRID}>
        <Tile
          label="Fleet compliance"
          value={String(avgCompliance)}
          color={scoreHex(avgCompliance)}
          sub={`mean across ${doc.repos.length} repos`}
        />
        <Tile
          label="On current revision"
          value={`${doc.adoptionRate}%`}
          color={scoreHex(doc.adoptionRate)}
          sub={lagging ? `${lagging} behind ${doc.version}` : "whole fleet current"}
        />
        <Tile label="Open breaches" value={String(breaches)} color={breaches ? "#ef4444" : "#16a34a"} sub="changes inside a no-AI zone" />
        <Tile
          label="Weakest repo"
          value={worst ? String(worst.compliance) : "—"}
          color={worst ? scoreHex(worst.compliance) : undefined}
          sub={worst ? worst.name : "no repos bound"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section>
          <Kicker>Amendments</Kicker>
          <p className="mb-4 mt-2 text-sm text-slate-400">
            Each revision tightened something. A repo that never acknowledged an amendment is still merging under the
            older rules.
          </p>
          <VersionTimeline doc={doc} />
        </section>

        <section>
          <Kicker>Clause adoption</Kicker>
          <p className="mb-4 mt-2 max-w-2xl text-sm text-slate-400">
            How much of the contract the fleet actually honours, clause by clause. An advisory clause with low coverage
            is the candidate for the next amendment — or for deletion.
          </p>
          <ClauseAdoption doc={doc} />
        </section>
      </div>

      <section>
        <Kicker>The ledger · weakest first</Kicker>
        <p className="mb-3 mt-2 max-w-3xl text-base text-slate-300">
          One row per bound repository, scored against {doc.version}. Compliance combines acknowledgement, provenance
          coverage and open breaches — the three things a stance can actually be checked on.
        </p>
        <ComplianceLedger doc={doc} />
      </section>
    </div>
  );
}
