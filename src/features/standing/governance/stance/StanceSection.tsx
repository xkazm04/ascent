// The AI-stance section of the Governance tab (W3) — the Perimeter prototype made real. SERVER
// component: reads the active/draft stance + the fleet compliance overview (existing scan data
// only) and renders either the perimeter readout or the publish-CTA empty state, with the owner's
// editor below in both cases. Sits alongside the gate cards — the gate is the enforced bar, the
// stance is the declared policy; the section header says which is which.

import { Kicker } from "@/components/ui";
import { getDraftOrgStance, getActiveOrgStance, isDbConfigured } from "@/lib/db";
import { buildStanceOverview } from "@/lib/org/stance-overview";
import { StancePerimeter } from "./StancePerimeter";
import { StancePublishCta } from "./stanceShared";
import { StanceEditor } from "./StanceEditor";

export async function StanceSection({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  if (!isDbConfigured()) return null; // stance is a persisted artifact — nothing to show DB-less

  const [overview, draft, active] = await Promise.all([
    buildStanceOverview(slug),
    getDraftOrgStance(slug),
    getActiveOrgStance(slug),
  ]);

  // What a publish from the editor would create; the server recomputes authoritatively.
  const nextVersion = (active?.version ?? 0) + 1;
  // Seed the editor from the draft when one exists (work in progress), else the active stance
  // (edit-to-amend), else blank.
  const editorSeed = draft?.stance ?? active?.stance ?? null;

  return (
    <section className="space-y-4 border-t border-slate-800 pt-6">
      <div>
        <Kicker>AI stance</Kicker>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          The org&apos;s published AI policy, versioned, acknowledged per repo, and read against observed git
          attribution. Declared policy, distinct from the enforced maturity gate above.
        </p>
      </div>

      {overview ? <StancePerimeter overview={overview} canEdit={canEdit} /> : <StancePublishCta slug={slug} canEdit={canEdit} />}

      {canEdit && (
        <div>
          {draft && (
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
              Unpublished draft in progress (v{draft.version})
            </p>
          )}
          <StanceEditor org={slug} initial={editorSeed} nextVersion={nextVersion} />
        </div>
      )}
    </section>
  );
}
