// The AI change-management evidence pack, on the Governance tab (W2).
//
// Placed here rather than on Audit because this is where the org's stance and its gate policy live:
// the pack is the EVIDENCE THAT THOSE CONTROLS OPERATED, and a reader who has just set a review
// requirement is exactly the reader who needs to file proof of it.
//
// The card's job is to set expectations honestly BEFORE the download, not to sell it. An examiner who
// discovers a caveat after relying on a figure will not trust the next artifact, so the population's
// lower-bound nature and the pseudonymous default are stated on the card itself — the same words the
// manifest opens with.
//
// Server-safe — no hooks, no handlers; the three actions are plain download links.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { DEFAULT_SAMPLE_SIZE } from "@/lib/conformance/sample";

function href(slug: string, file: string, named: boolean): string {
  const p = new URLSearchParams({ org: slug, file });
  if (named) p.set("identities", "named");
  return `/api/org/conformance-pack?${p.toString()}`;
}

const linkClass =
  "focus-ring rounded-md border border-divider px-3 py-1.5 text-sm text-slate-300 transition hover:border-accent hover:text-white";

export function EvidencePackCard({ slug, canExportNamed }: { slug: string; canExportNamed: boolean }) {
  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Change-management evidence pack"
        description="The artifact an examiner asks for: the population of AI-attributed changes in the period, a reproducible sample drawn from it, and per-item evidence of whether a human approving review happened before merge."
      />

      <div className="mt-4 space-y-3 text-sm text-slate-400">
        <p>
          Evidence <strong className="font-medium text-slate-200">for</strong> an internal change-management control:
          the criterion a SOC 2 Type II examination tests, and an input to an ISO/IEC 42001 Statement of Applicability.
          It is not a certification and makes no claim under the EU AI Act. Ascent certifies nothing; the examiner
          decides.
        </p>
        <p>
          The sample is drawn by a seeded shuffle over the period&apos;s changes, so re-running this export reproduces
          the same rows. The seed is printed in the manifest. Default draw is {DEFAULT_SAMPLE_SIZE} items; the{" "}
          <strong className="font-medium text-slate-200">findings</strong> file lists every merged-without-approval
          change in the <em>full</em> population, not only the sampled ones.
        </p>
        <p className="rounded-lg border border-dashed border-divider bg-surface/40 px-3 py-2">
          <span className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">Before you file it</span> The
          population is a <strong className="font-medium text-slate-200">lower bound</strong>: a change is recorded
          only when it falls inside a repository&apos;s scanned pull-request window, and AI assistance left unmarked is
          not detected at all. Identities are pseudonymous unless an owner exports named evidence. Every limitation is
          restated at the top of the manifest.
        </p>
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

      {canExportNamed && (
        <div className="mt-3">
          <a href={href(slug, "manifest", true)} className={`${linkClass} border-amber-500/40 text-amber-200`}>
            <span aria-hidden>↓</span> Named manifest (real logins)
          </a>
          <p className="mt-2 text-sm text-slate-500">
            Named evidence puts real GitHub logins against changes that merged unreviewed. Export it when an examiner
            needs to re-verify specific rows against GitHub, not as the default artifact you circulate.
          </p>
        </div>
      )}
    </Card>
  );
}
