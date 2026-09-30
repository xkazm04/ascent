// AI stance under Prism. Same reads as StanceSection: active stance, draft, and the fleet overview.
// A missing database hides the section. A missing published stance is the empty frame, not a zero.
import { Caption, Frame, SectionHead } from "@/components/kit";
import { getActiveOrgStance, getDraftOrgStance, isDbConfigured } from "@/lib/db";
import { buildStanceOverview } from "@/lib/org/stance-overview";
import { StanceEditorV2 } from "./StanceEditor.v2";
import { StanceEmptyV2 } from "./StanceEmpty.v2";
import { StancePerimeterV2 } from "./StancePerimeter.v2";

export async function StanceFrameV2({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  if (!isDbConfigured()) return null;
  const [overview, draft, active] = await Promise.all([
    buildStanceOverview(slug),
    getDraftOrgStance(slug),
    getActiveOrgStance(slug),
  ]);
  const nextVersion = (active?.version ?? 0) + 1;
  const editorSeed = draft?.stance ?? active?.stance ?? null;
  return (
    <Frame aria-label="AI stance">
      {overview ? (
        <>
          <SectionHead
            eyebrow="AI stance"
            title="Declared policy,"
            named="not the enforced gate."
            lede="The stance is read against observed git attribution and reported. The maturity gate above is the bar that can fail a change."
          />
          <div className="mt-6">
            <StancePerimeterV2 overview={overview} canEdit={canEdit} />
          </div>
        </>
      ) : (
        <StanceEmptyV2 slug={slug} canEdit={canEdit} />
      )}
      {canEdit && (
        <div className="mt-8">
          {draft && <Caption className="mb-3">Unpublished draft in progress (v{draft.version})</Caption>}
          <StanceEditorV2 org={slug} initial={editorSeed} nextVersion={nextVersion} />
        </div>
      )}
    </Frame>
  );
}
