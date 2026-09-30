// Prism segment maturity: a paper table, then one ruled row per slice with its scan controls.
import { Caption, CellMark, DataTable, CELL, CELL_NUM, HEAD_CELL, Frame, HairlineList, SectionHead, VoidMark } from "@/components/kit";
import { levelForScore } from "@/lib/maturity/model";
import type { SegmentSummary } from "@/lib/db";
import { SCORED_COUNT_HINT, taggedScoredLabel } from "./segmentCounts";
import { postureText } from "./SegmentCard";
import { SegmentActionsV2 } from "./SegmentActions.v2";

function ScoreCell({ value }: { value: number | null }) {
  if (value == null) return <CellMark state="unmeasured" />;
  return <span className="tabular-nums text-white">{value}</span>;
}

export function SegmentMaturityV2({
  slug,
  summaries,
  reposBySegment,
  watched,
}: {
  slug: string;
  summaries: SegmentSummary[];
  reposBySegment: Record<string, string[]>;
  watched: Set<string>;
}) {
  return (
    <Frame edge="top" pad="md" aria-label="Segment maturity">
      <SectionHead
        eyebrow="Segment maturity"
        title="Where each slice stands"
        lede={`${summaries.length} slice${summaries.length === 1 ? "" : "s"}. Scores are 0 to 100, from the latest scans.`}
      />
      <Caption className="mt-3">
        A segment with no scanned repository is not measured. Its averages are not a score of 0, so no number is printed.
      </Caption>
      <div className="mt-4">
        <DataTable
          variant="plain"
          size="sm"
          minWidth={520}
          caption="Segment maturity on overall, adoption, and rigor"
          head={
            <tr>
              <th className={HEAD_CELL}>Segment</th>
              <th className={HEAD_CELL}>Overall</th>
              <th className={HEAD_CELL}>Adopt</th>
              <th className={HEAD_CELL}>Rigor</th>
            </tr>
          }
        >
          {summaries.map((s) => (
            <tr key={s.id ?? "fleet"}>
              <td className={CELL}>{s.name}</td>
              <td className={CELL_NUM}><ScoreCell value={s.avgOverall} /></td>
              <td className={CELL_NUM}><ScoreCell value={s.avgAdoption} /></td>
              <td className={CELL_NUM}><ScoreCell value={s.avgRigor} /></td>
            </tr>
          ))}
        </DataTable>
      </div>
      <HairlineList className="mt-6" aria-label="Segment controls">
        {summaries.map((s) => {
          const score = s.avgOverall;
          const level = score === null ? null : levelForScore(score);
          const tagged = s.id ? reposBySegment[s.id] ?? [] : [];
          const repos = tagged.filter((fn) => watched.has(fn));
          const counts = taggedScoredLabel(tagged.length, score === null ? null : s.scannedCount);
          return (
            <li key={s.id ?? "fleet"} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[1.0625rem] font-semibold tracking-[-0.01em] text-white">{s.name}</div>
                  <p className="mt-1 type-caption text-slate-400">
                    {score === null || level === null ? "No scans yet, scan this segment to score it" : `${level.id} · ${level.name}`}
                    {s.posture !== null ? ` · ${postureText(s.posture)}` : ""}
                  </p>
                  <p className="type-caption text-slate-400" title={SCORED_COUNT_HINT}>{counts}</p>
                </div>
                <div className="text-[1.75rem] font-light leading-none tabular-nums text-white">
                  {score === null ? <VoidMark subject={`${s.name} average`} /> : score}
                </div>
              </div>
              {s.id && <SegmentActionsV2 org={slug} segmentId={s.id} repos={repos} taggedCount={tagged.length} />}
            </li>
          );
        })}
      </HairlineList>
    </Frame>
  );
}
