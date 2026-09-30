"use client";

// Prism doctor checks. Same fetch and the same four states as ControlMatrixPanel. Failing is a
// count in paper. An error is a mark plus the words, not an amber panel.
import { WhyChip } from "@/components/org/viz";
import { Caption, Frame, Lede, SectionHead, StatStrip, StatTile } from "@/components/kit";
import { orgTabHref } from "@/lib/org/orgTabs";
import { MarkGridV2 } from "../MarkGrid.v2";
import { ControlMatrixGridV2 } from "./ControlMatrixGrid.v2";
import { controlVizModel } from "./controlMatrixViz";
import { useControlMatrix } from "./useControlMatrix";

const AUDIT_HINT =
  "These rows are derived. The tamper-evident copy of every report is the signed conformance.reported entry in this organization's audit log.";

export function ControlMatrixPanelV2({ org }: { org: string }) {
  const { rows, loading, error, expanded, toggleFamily } = useControlMatrix(org);
  const reporting = rows?.filter((r) => !r.summaryOnly) ?? [];
  const failing = reporting.filter((r) => r.checks.some((c) => c.level === "fail")).length;
  const summaryOnly = rows?.filter((r) => r.summaryOnly).length ?? 0;
  const viz = controlVizModel(rows ?? []);

  return (
    <div className="space-y-10">
      <SectionHead
        id="doctor-checks-heading"
        eyebrow="Proven in your own CI"
        title="Doctor"
        named="checks."
        actions={<WhyChip hint={AUDIT_HINT} label="how these rows are stored" align="end" />}
      />

      {loading && <p className="text-[0.9375rem] text-slate-400">Loading the doctor-check matrix…</p>}

      {error && (
        <Frame>
          <p className="text-[1.0625rem] text-slate-300">
            <span aria-hidden>▲ </span>
            {error} Nothing is shown rather than an empty grid: an unanswered request is not evidence that the fleet has no controls.
          </p>
        </Frame>
      )}

      {!loading && !error && rows && rows.length === 0 && (
        <Lede>
          No repository in this organization has reported a doctor run yet. The quickest route is{" "}
          <a href={`${orgTabHref(org, "practices")}#foundation-rollout`} className="text-accent underline underline-offset-2">
            Practices › Foundation rollout
          </a>
          , which installs <code className="text-slate-200">.ai/</code> and provisions report-back, both secrets, per repo, in one click. By hand: wire{" "}
          <code className="text-slate-200">node .ai/doctor.mjs --json</code> into a repo&apos;s CI with <code className="text-slate-200">ASCENT_CONFORMANCE_URL</code> and{" "}
          <code className="text-slate-200">ASCENT_CONFORMANCE_TOKEN</code>. Either way, its controls appear here after the next run.
        </Lede>
      )}

      {!loading && !error && rows && rows.length > 0 && (
        <>
          <Frame aria-label="Doctor checks by repository and check family">
            <MarkGridV2 axes={viz.axes} rows={viz.rows} subject="Repository" title="Doctor checks by repository and check family" />
            <Caption className="mt-3">A number is the share of judged clauses that passed. Not measured was not judged, and it is not a zero.</Caption>
          </Frame>
          <StatStrip cols={3}>
            <StatTile label="Repos reporting" value={reporting.length} sub={`${rows.length} have reported at all`} />
            <StatTile label="With a failing control" value={failing} sub="in their latest run" />
            <StatTile
              label="Summary-only reporters"
              value={summaryOnly}
              sub={summaryOnly ? "doctor < 0.3.0: no clause-level result" : "every reporter sends findings"}
            />
          </StatStrip>
          <ControlMatrixGridV2 rows={rows} expanded={expanded} onToggleFamily={toggleFamily} />
        </>
      )}
    </div>
  );
}
