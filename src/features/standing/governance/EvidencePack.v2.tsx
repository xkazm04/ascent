// Change-management evidence, as a hairline frame. The three stages are the same evidenceFlow the
// export uses. A stage that could not be read is a void, never a zero. Measured zeros stay zeros.
import { Caption, GhostAction, Frame, SectionHead, StatStrip, StatTile, VoidMark } from "@/components/kit";
import { getAiChangePopulation } from "@/lib/db/ai-changes";
import { resolveOrgWindow } from "@/lib/org/period";
import { DEFAULT_SAMPLE_SIZE } from "@/lib/conformance/sample";
import { evidenceFlow, periodBound } from "./evidenceFlow";
import type { GovernanceSearchParams } from "./governanceView";

function href(slug: string, file: string, named: boolean): string {
  const p = new URLSearchParams({ org: slug, file });
  if (named) p.set("identities", "named");
  return `/api/org/conformance-pack?${p.toString()}`;
}

const SAMPLE_HINT =
  `The sample is drawn by a seeded shuffle over the period's changes, so re-running this export reproduces the ` +
  `same rows. The seed is printed in the manifest. The default draw is ${DEFAULT_SAMPLE_SIZE} items, while the ` +
  `findings file lists every merged-without-approval change in the full population, not only the sampled ones.`;

export async function EvidencePackV2({
  slug,
  canExportNamed,
  sp,
}: {
  slug: string;
  canExportNamed: boolean;
  sp: GovernanceSearchParams;
}) {
  const period = await resolveOrgWindow(sp);
  const pop = await getAiChangePopulation(slug, { start: period.start, end: period.end }).catch(() => null);
  const flow = evidenceFlow(pop, slug, periodBound(period.start), periodBound(period.end));

  return (
    <Frame aria-label="Change-management evidence pack">
      <SectionHead
        eyebrow="Evidence"
        title="Change-management pack"
        named={period.title}
        lede="A seeded draw, so this picture and the export name the same rows."
      />
      <StatStrip cols={3} className="mt-5">
        {flow.stages.map((s) => (
          <StatTile
            key={s.id}
            label={s.label}
            value={s.value == null ? <VoidMark subject={s.label} label="Not measured" /> : String(s.value)}
            sub={s.value == null ? "not measured" : "in this period"}
          />
        ))}
      </StatStrip>
      <Caption className="mt-3">{SAMPLE_HINT}</Caption>
      <div className="mt-4 space-y-1 type-body-sm text-slate-400">
        {flow.notApplicable > 0 && (
          <p>
            {flow.notApplicable} sampled change{flow.notApplicable === 1 ? "" : "s"} never merged, so the pre-merge
            control was not due to operate.
          </p>
        )}
        {flow.unmeasured && <p>The population could not be read for this period. Nothing here is a zero.</p>}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <GhostAction href={href(slug, "manifest", false)}>Manifest (.md)</GhostAction>
        <GhostAction href={href(slug, "sample", false)}>Sample (.csv)</GhostAction>
        <GhostAction href={href(slug, "findings", false)}>Findings (.csv)</GhostAction>
      </div>
      <p className="mt-5 max-w-[40rem] type-body-sm text-slate-400">
        <span className="text-slate-200">Before you file it. </span>
        The population is a <strong className="font-medium text-slate-200">lower bound</strong>: a change is recorded
        only when it falls inside a repository&apos;s scanned pull-request window, and AI assistance left unmarked is
        not detected at all. Identities are pseudonymous unless an owner exports named evidence. Ascent certifies
        nothing; the examiner decides. Every limitation is restated at the top of the manifest.
      </p>
      {canExportNamed && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2">
            <GhostAction href={href(slug, "manifest", true)}>Named manifest (real logins)</GhostAction>
            <GhostAction href={href(slug, "sample", true)}>Named sample (.csv)</GhostAction>
            <GhostAction href={href(slug, "findings", true)}>Named findings (.csv)</GhostAction>
          </div>
          <p className="mt-2 max-w-[40rem] type-body-sm text-slate-400">
            Named evidence puts real GitHub logins against changes that merged unreviewed. Export it when an examiner
            needs to re-verify specific rows against GitHub, not as the default artifact you circulate.
          </p>
        </div>
      )}
    </Frame>
  );
}
