// Delivery outcomes (W4) — the DORA read, and the number this wave exists for: do AI-attributed
// changes fail more than human-authored ones?
//
// That sentence is the most quotable thing this product can produce, which is exactly why the panel
// spends more space on its limits than on its headline. Four of them, all rendered, none optional:
//
//   1. "FAILURE" MEANS THE DEPLOYMENT FAILED — not "caused an incident". Only the first is
//      observable from GitHub's Deployments API, and "change failure rate" is a term of art a reader
//      will otherwise hear as the second.
//   2. ATTRIBUTION COVERAGE IS PRINTED. A split over 12 of 51 deployments means something very
//      different from one over 49, and the reader must not have to ask.
//   3. THE HUMAN BUCKET IS CONTAMINATED IN AI'S FAVOUR. Unmarked AI assistance is invisible to the
//      detector, so it lands in "human". A measured AI-fails-more result is therefore conservative;
//      an AI-fails-less result should be read with that in mind. Said on the panel, not in a doc.
//   4. NO RATE UNDER THE SAMPLE FLOOR. One bad deploy out of one is not a 100% failure rate.
//
// Server-safe — no hooks, no handlers.

import { Card, OrgTable, SectionHeader, Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import { MIN_DEPLOYMENTS, type DeliveryOutcomes as Outcomes, type OutcomeBucket } from "@/lib/db/delivery-outcomes";

const BAD = "#f97316";
const GOOD = "#22c55e";

function Rate({ bucket }: { bucket: OutcomeBucket }) {
  if (bucket.failureRate == null) {
    return (
      <span
        className="font-mono tabular-nums text-slate-500"
        title={`Fewer than ${MIN_DEPLOYMENTS} attributed deployments — too small a sample to state a rate`}
      >
        —
      </span>
    );
  }
  return (
    <span className="font-mono tabular-nums" style={{ color: bucket.failureRate > 0 ? BAD : GOOD }}>
      {bucket.failureRate}%
    </span>
  );
}

export function DeliveryOutcomes({ slug, outcomes, periodTitle }: { slug: string; outcomes: Outcomes; periodTitle: string }) {
  // No deployments is an honest state with an actionable cause, not an error and not a zero.
  if (outcomes.total === 0) {
    return (
      <Card>
        <SectionHeader
          size="sm"
          title="Delivery outcomes"
          description="Deployment frequency, change-failure rate, and whether AI-attributed changes fail more often than human-authored ones."
        />
        <p className="mt-3 text-sm text-slate-400">
          No deployments recorded in {periodTitle.toLowerCase()}. Ascent reads the GitHub Deployments API during a scan
          — a repository that deploys another way (or whose scan ran without a token) contributes nothing here.{" "}
          <a href={orgTabHref(slug, "repositories")} className="focus-ring text-accent hover:text-white">
            Re-scan the fleet
          </a>{" "}
          after deployments exist and this fills in.
        </p>
      </Card>
    );
  }

  const gap = outcomes.failureRateGap;

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Delivery outcomes"
        description={`${outcomes.total.toLocaleString()} deployments across ${outcomes.environments.length} ${outcomes.environments.length === 1 ? "environment" : "environments"} in ${periodTitle.toLowerCase()}, from the GitHub Deployments API.`}
      />

      <div className={`${TILE_LEDGER} mt-4 grid-cols-2 sm:grid-cols-4`}>
        <Tile
          label="Deploys / week"
          value={outcomes.perWeek == null ? "—" : String(outcomes.perWeek)}
          sub="successful only"
        />
        <Tile
          label="Change-failure rate"
          value={outcomes.failureRate == null ? "—" : `${outcomes.failureRate}%`}
          sub={outcomes.failureRate == null ? `under ${MIN_DEPLOYMENTS} deployments` : `${outcomes.failed} of ${outcomes.total} failed`}
          color={outcomes.failureRate ? BAD : undefined}
        />
        <Tile
          label="Time to next success"
          value={outcomes.medianRestoreHours == null ? "—" : `${outcomes.medianRestoreHours}h`}
          sub="median, after a failure"
        />
        <Tile
          label="Attribution coverage"
          value={outcomes.coverage == null ? "—" : `${outcomes.coverage}%`}
          sub={`${outcomes.attributed} of ${outcomes.total} matched a change`}
        />
      </div>

      <div className="mt-4">
        <OrgTable
          caption="Change-failure rate by authorship"
          minWidth={520}
          head={
            <tr className="text-left">
              <th className="px-4 py-3">Authored</th>
              <th className="px-4 py-3 text-right">Deployments</th>
              <th className="px-4 py-3 text-right">Failed</th>
              <th className="px-4 py-3 text-right">Failure rate</th>
            </tr>
          }
        >
          <tr>
            <td className="px-4 py-3 text-white">AI-attributed</td>
            <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{outcomes.ai.deployments}</td>
            <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{outcomes.ai.failed}</td>
            <td className="px-4 py-3 text-right">
              <Rate bucket={outcomes.ai} />
            </td>
          </tr>
          <tr>
            <td className="px-4 py-3 text-white">Human-authored</td>
            <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{outcomes.human.deployments}</td>
            <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{outcomes.human.failed}</td>
            <td className="px-4 py-3 text-right">
              <Rate bucket={outcomes.human} />
            </td>
          </tr>
        </OrgTable>
      </div>

      {gap != null && (
        <p className="mt-3 rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3 text-base text-slate-200">
          <span className="font-mono text-sm uppercase tracking-widest text-accent">
            {gap > 0 ? "AI changes fail more" : gap < 0 ? "AI changes fail less" : "No measured difference"}
          </span>{" "}
          {gap === 0
            ? `Both buckets failed at ${outcomes.ai.failureRate}% over ${periodTitle.toLowerCase()}.`
            : `${Math.abs(gap)} points ${gap > 0 ? "higher" : "lower"} than human-authored changes over ${periodTitle.toLowerCase()} — ${outcomes.ai.failureRate}% vs ${outcomes.human.failureRate}%.`}
        </p>
      )}

      <p className="mt-4 rounded-lg border border-dashed border-divider bg-surface/40 px-3 py-2 text-sm text-slate-400">
        <span className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">How to read this</span>{" "}
        <strong className="font-medium text-slate-200">&ldquo;Failure&rdquo; means the deployment failed</strong> — it
        does not mean the change caused an incident. Nothing here observes your service; that claim would need a
        different source. &ldquo;Time to next success&rdquo; is the interval to the next successful deployment in the
        same environment, a proxy for restore time rather than a measurement of it.
        {outcomes.unattributed > 0 && (
          <>
            {" "}
            <strong className="font-medium text-amber-200">
              {outcomes.unattributed} of {outcomes.total} deployments could not be matched to a merged change
            </strong>{" "}
            — a deployment names the commit it shipped, and it is attributed only when that commit is a pull
            request&apos;s merge commit we recorded. Merge trains, tag-based deploys, and repositories scanned before
            deployment tracking existed all land here. They are excluded from the split above, never defaulted into a
            bucket.
          </>
        )}{" "}
        <strong className="font-medium text-slate-200">Human-authored is a residual.</strong> AI assistance a developer
        did not mark is invisible to the detector and lands in that bucket, so it is contaminated in AI&apos;s favour —
        a measured &ldquo;AI fails more&rdquo; is conservative, and an &ldquo;AI fails less&rdquo; should be read with
        that in mind. Rates under {MIN_DEPLOYMENTS} deployments are withheld rather than stated.
      </p>
    </Card>
  );
}
