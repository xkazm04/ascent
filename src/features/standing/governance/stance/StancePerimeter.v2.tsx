// Published stance, Prism. Figures stay paper. The ladder's status hues are not redrawn here: each
// band says measured, declared, or not judged in words, and the repos are ruled rows.
import type { ReactNode } from "react";
import { Caption, SectionHead, StatStrip, StatTile, VoidMark } from "@/components/kit";
import { unenforceableClauses } from "@/lib/org/admission";
import type { StanceOverview } from "@/lib/org/stance-overview";
import { perimeterEdge } from "./perimeterLadder";
import { StanceApplyControl } from "./StanceApplyControl";
import { AdmissionColumn } from "./admission/AdmissionColumn";
import { UnenforceableClauses } from "./UnenforceableClauses";
import { CheckpointV2 } from "./Checkpoint.v2";
import { SealedV2 } from "./Sealed.v2";
import { StanceBandsV2 } from "./StanceBands.v2";

function marked(n: number, risk: boolean): ReactNode {
  if (!risk) return String(n);
  return (
    <>
      <span aria-hidden className="mr-1 align-middle text-[0.45em]">
        ▲
      </span>
      <span className="sr-only">At risk: </span>
      {n}
    </>
  );
}

export function StancePerimeterV2({ overview, canEdit }: { overview: StanceOverview; canEdit: boolean }) {
  const o = overview;
  const edge = perimeterEdge(o.undeclaredTools);
  const stamp = [
    `v${o.stanceVersion}`,
    o.publishedAt ? `effective ${o.publishedAt}` : null,
    o.publishedBy ? `@${o.publishedBy}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div>
      <SectionHead
        eyebrow="Perimeter"
        title="The AI perimeter,"
        named={`${o.repos.length} scanned repos.`}
        lede="Declared policy, read against observed git attribution. It is not the maturity gate above, and it is never enforced."
      />
      <Caption className="mt-3">{stamp}</Caption>
      <StatStrip cols={4} className="mt-5">
        <StatTile label="Inside the line" value={String(o.repos.length)} sub="scanned repos read against the stance" />
        <StatTile
          label="Elevated or restricted"
          value={marked(o.elevatedCount, o.elevatedCount > 0)}
          sub="T2 or higher, real autonomy tier"
        />
        <StatTile
          label="Findings"
          value={marked(o.findingCount, o.findingCount > 0)}
          sub="observed attribution versus the declaration"
        />
        <StatTile
          label="Acknowledged"
          value={o.repos.length === 0 ? <VoidMark subject="Acknowledgement" label="Not measured" /> : `${o.ackRate}%`}
          sub={o.repos.length === 0 ? "no repos read" : `repos on v${o.stanceVersion}`}
        />
      </StatStrip>
      {edge && (
        <p className="mt-4 type-body-sm text-slate-400">
          <span aria-hidden>▲ </span>
          {edge.count} undeclared tool{edge.count === 1 ? "" : "s"} observed crossing.
        </p>
      )}
      {canEdit && (
        <div className="mt-6">
          <StanceApplyControl org={o.org} repos={o.repos.map((r) => r.fullName)} version={o.stanceVersion} />
        </div>
      )}
      <div className="mt-8">
        <SectionHead eyebrow="Checkpoint" title="What may cross," named="and what did." />
        <div className="mt-4">
          <CheckpointV2 stance={o.stance} undeclared={o.undeclaredTools} />
        </div>
      </div>
      <StanceBandsV2 overview={o} canEdit={canEdit} />
      <div className="mt-8">
        <AdmissionColumn org={o.org} canEdit={canEdit} />
      </div>
      <SealedV2 zones={o.zones} />
      <div className="mt-8">
        <UnenforceableClauses clauses={unenforceableClauses(o.stance, null)} />
      </div>
    </div>
  );
}
