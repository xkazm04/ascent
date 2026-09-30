// Per-repo PR ledger. Same columns, titles, and 12-row fold as the Altimeter table.
// A null rate is a void. A measured number stays paper, including a revert rate and a zero count.
import Link from "next/link";
import { CELL, CELL_NUM, DataTable, HEAD_CELL } from "@/components/kit";
import type { PrRepoRow } from "@/lib/db";
import type { FleetRateId } from "@/lib/db/org-signals";
import { repoBasisMark, repoBasisTitle } from "./prBasis";
import { hoursLabel, Unknown } from "./deliveryV2Marks";

const VISIBLE_ROWS = 12;
const NUM = `${CELL_NUM} text-slate-200`;

function Rate({ value, id, row, reason }: { value: number | null; id: FleetRateId; row: PrRepoRow; reason?: string }) {
  const basis = repoBasisTitle(id, row.population[id]);
  if (value == null) {
    const title = [reason, "Not measured, never a zero.", basis].filter(Boolean).join(" ");
    return (
      <span title={title}>
        <Unknown />
      </span>
    );
  }
  const mark = repoBasisMark(row.population[id]) ?? "/?";
  return (
    <span title={basis} className="whitespace-nowrap">
      {value}%<span className="text-slate-400">{mark}</span>
    </span>
  );
}

function Hours({ h, title }: { h: number | null; title: string }) {
  const label = hoursLabel(h);
  return <span title={title}>{label ?? <Unknown />}</span>;
}

function Head() {
  return (
    <tr>
      <th className={HEAD_CELL}>Repo</th>
      <th className={`${HEAD_CELL} text-right`} title="PRs analyzed in this repo's latest scan. The denominator of the analyzed-based rates only; every other cell carries its own /N">PRs</th>
      <th className={`${HEAD_CELL} text-right`}>Merge</th>
      <th className={`${HEAD_CELL} text-right`} title="human-merged PRs with an approving review">Reviewed</th>
      <th className={`${HEAD_CELL} text-right`} title="PRs of 200 changed lines or fewer">Small</th>
      <th className={`${HEAD_CELL} text-right`}>AI share</th>
      <th className={`${HEAD_CELL} text-right`} title="merged PRs whose commit messages carry an AI attribution trailer (Co-Authored-By / Assisted-By)">AI trailers</th>
      <th className={`${HEAD_CELL} text-right`} title="merged PRs reviewed by an AI or bot reviewer before the first human review">AI pre-review</th>
      <th className={`${HEAD_CELL} text-right`} title="AI-involved PRs with an approving review">AI reviewed</th>
      <th className={`${HEAD_CELL} text-right`} title="PRs whose title starts with Revert (shipped work that came back out)">Reverts</th>
      <th className={`${HEAD_CELL} text-right`} title="median hours from opening to first review">1st review</th>
      <th className={`${HEAD_CELL} text-right`} title="median hours to merge">Merge time</th>
    </tr>
  );
}

function Row({ r }: { r: PrRepoRow }) {
  return (
    <tr>
      <td className={CELL}>
        <Link href={`/report/${r.fullName}`} className="focus-ring text-white hover:underline">{r.name}</Link>
      </td>
      <td className={`${CELL_NUM} text-slate-400`}>{r.analyzed}</td>
      <td className={NUM}><Rate value={r.mergeRate} id="merge" row={r} /></td>
      <td className={NUM}><Rate value={r.reviewedRate} id="reviewed" row={r} reason="no human-merged PRs in the window" /></td>
      <td className={NUM}><Rate value={r.smallPrRate} id="smallPr" row={r} /></td>
      <td className={NUM}><Rate value={r.aiInvolvedRate} id="aiInvolved" row={r} /></td>
      <td className={NUM}><Rate value={r.aiTrailerRate} id="aiTrailer" row={r} reason="scan predates trailer tracking, or fewer than 5 merged PRs" /></td>
      <td className={NUM}><Rate value={r.aiPreReviewedRate} id="aiPreReviewed" row={r} reason="scan predates pre-review tracking, or fewer than 5 merged PRs" /></td>
      <td className={NUM}><Rate value={r.aiGovernedRate} id="aiGoverned" row={r} reason="too few AI-involved PRs to measure" /></td>
      <td className={NUM}><Rate value={r.revertRate} id="revert" row={r} reason="scan predates revert tracking, or too few PRs to measure (rescan)" /></td>
      <td className={NUM}><Hours h={r.medianHoursToFirstReview} title="median hours to first review" /></td>
      <td className={NUM}><Hours h={r.medianHoursToMerge} title="median hours to merge" /></td>
    </tr>
  );
}

function Table({ rows, caption }: { rows: PrRepoRow[]; caption: string }) {
  return (
    <DataTable density="compact" stickyFirstCol minWidth={1100} size="sm" caption={caption} head={<Head />}>
      {rows.map((r) => <Row key={r.fullName} r={r} />)}
    </DataTable>
  );
}

export function DeliveryPrTableV2({ rows }: { rows: PrRepoRow[] }) {
  const visible = rows.slice(0, VISIBLE_ROWS);
  const folded = rows.slice(VISIBLE_ROWS);
  return (
    <div>
      <Table rows={visible} caption="Pull-request signals by repository, riskiest first" />
      {folded.length > 0 && (
        <details className="group mt-3">
          <summary className="focus-ring cursor-pointer text-slate-400">
            {folded.length} more repo{folded.length > 1 ? "s" : ""} with healthier signals
          </summary>
          <div className="mt-3">
            <Table rows={folded} caption="Remaining repositories (healthier pull-request signals)" />
          </div>
        </details>
      )}
    </div>
  );
}
