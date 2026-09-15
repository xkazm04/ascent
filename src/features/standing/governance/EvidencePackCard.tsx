// The AI change-management evidence pack, on the Governance tab (W2).
//
// Placed here rather than on Audit because this is where the org's stance and its gate policy live:
// the pack is the EVIDENCE THAT THOSE CONTROLS OPERATED, and a reader who has just set a review
// requirement is exactly the reader who needs to file proof of it.
//
// The card's job is to set expectations honestly BEFORE the download, not to sell it. Org UX
// redesign §2: the three-clause standfirst is now the `FlowRibbon` (population → sampled →
// reviewed), drawn over the SAME window and the SAME seed the export would use — so the headline
// and the artifact cannot disagree. The lower-bound limitation deliberately STAYS in visible text:
// this repo's own rule for a disclaimer that protects a reader from over-claiming is that a
// screenshot crops tooltips and keeps text (see ControlStateCell.tsx).
//
// Server-safe — no hooks, no handlers; the three actions are plain download links. It owns one read
// (the period's AI-change population, the same one /api/org/conformance-pack performs) because a
// ribbon with three voids in it would be honest and useless.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { FlowRibbon, WhyChip } from "@/components/org/viz";
import { getAiChangePopulation } from "@/lib/db/ai-changes";
import { resolveOrgWindow } from "@/lib/org/period";
import { DEFAULT_SAMPLE_SIZE } from "@/lib/conformance/sample";
import { evidenceFlow, periodBound } from "./evidenceFlow";

type SearchParams = { [key: string]: string | string[] | undefined };

function href(slug: string, file: string, named: boolean): string {
  const p = new URLSearchParams({ org: slug, file });
  if (named) p.set("identities", "named");
  return `/api/org/conformance-pack?${p.toString()}`;
}

const linkClass =
  "focus-ring rounded-md border border-divider px-3 py-1.5 type-body-sm text-slate-300 transition hover:border-accent hover:text-white";

/** The demoted sampling rationale (D) — the seeded draw, reachable beside the ribbon it explains. */
const SAMPLE_HINT =
  `The sample is drawn by a seeded shuffle over the period's changes, so re-running this export reproduces the ` +
  `same rows; the seed is printed in the manifest. The default draw is ${DEFAULT_SAMPLE_SIZE} items, while the ` +
  `findings file lists every merged-without-approval change in the FULL population, not only the sampled ones.`;

export async function EvidencePackCard({
  slug,
  canExportNamed,
  sp,
}: {
  slug: string;
  canExportNamed: boolean;
  sp: SearchParams;
}) {
  // The window every org tab resolves the same way, so the picture covers the period the dashboard
  // shows and the download link produces the same rows. Never fatal: an unreadable population draws
  // three voids and says so, rather than withholding the actions that are the point of the card.
  const period = await resolveOrgWindow(sp);
  const pop = await getAiChangePopulation(slug, { start: period.start, end: period.end }).catch(() => null);
  const flow = evidenceFlow(pop, slug, periodBound(period.start), periodBound(period.end));

  return (
    <Card>
      <SectionHeader size="sm" title="Change-management evidence pack" description={period.title} />

      {/* §2.2 — the funnel is the first thing under the header. */}
      <div className="mt-4 flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="max-w-sm flex-1">
          <FlowRibbon stages={flow.stages} title="Evidence chain" />
        </div>
        <div className="flex flex-col gap-2 pt-2">
          <span className="inline-flex items-center gap-1.5">
            <WhyChip label="how the sample is drawn" hint={SAMPLE_HINT} />
            <span className="type-body-sm text-slate-500">reproducible draw</span>
          </span>
          {flow.notApplicable > 0 && (
            <span className="type-body-sm text-slate-500">
              {flow.notApplicable} sampled change{flow.notApplicable === 1 ? "" : "s"} never merged — the pre-merge
              control was not due to operate
            </span>
          )}
          {flow.unmeasured && (
            <span className="type-body-sm text-slate-500">
              The population could not be read for this period. Nothing here is a zero.
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <a href={href(slug, "manifest", false)} className={linkClass}>
          <span aria-hidden>↓</span> Manifest (.md)
        </a>
        <a href={href(slug, "sample", false)} className={linkClass}>
          <span aria-hidden>↓</span> Sample (.csv)
        </a>
        <a href={href(slug, "findings", false)} className={linkClass}>
          <span aria-hidden>↓</span> Findings (.csv)
        </a>
      </div>

      <div className="mt-4 space-y-3 type-body-sm text-slate-400">
        <p className="rounded-lg border border-dashed border-divider bg-surface/40 px-3 py-2">
          <span className="font-mono type-micro uppercase tracking-[0.22em] text-slate-500">Before you file it</span> The
          population is a <strong className="font-medium text-slate-200">lower bound</strong>: a change is recorded
          only when it falls inside a repository&apos;s scanned pull-request window, and AI assistance left unmarked is
          not detected at all. Identities are pseudonymous unless an owner exports named evidence. Ascent certifies
          nothing; the examiner decides. Every limitation is restated at the top of the manifest.
        </p>
      </div>

      {canExportNamed && (
        <div className="mt-3">
          {/* UAT `NADIA-L1-10`: the card's own justification is "re-verify specific ROWS against
              GitHub" — and the rows live in sample.csv and findings.csv, which were offered
              anonymised only. All three named artifacts, or the reason is only half true. */}
          <div className="flex flex-wrap gap-2">
            <a href={href(slug, "manifest", true)} className={`${linkClass} border-amber-500/40 text-amber-200`}>
              <span aria-hidden>↓</span> Named manifest (real logins)
            </a>
            <a href={href(slug, "sample", true)} className={`${linkClass} border-amber-500/40 text-amber-200`}>
              <span aria-hidden>↓</span> Named sample (.csv)
            </a>
            <a href={href(slug, "findings", true)} className={`${linkClass} border-amber-500/40 text-amber-200`}>
              <span aria-hidden>↓</span> Named findings (.csv)
            </a>
          </div>
          <p className="mt-2 type-body-sm text-slate-500">
            Named evidence puts real GitHub logins against changes that merged unreviewed. Export it when an examiner
            needs to re-verify specific rows against GitHub, not as the default artifact you circulate.
          </p>
        </div>
      )}
    </Card>
  );
}
