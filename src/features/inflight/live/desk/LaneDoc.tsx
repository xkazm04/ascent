"use client";

// THE LANE PAGE — what one repo's cycle did: its verdict, a figure strip, the agent's report (a claim,
// shown beside the rescan's ruling), what it delivered and learned; the guard, the rescan, the facts and
// the log tail at the side. Prev/next walks every lane in history. No hooks.

import type { LoopRunDetail } from "../cockpit/loopTypes";
import type { DeskCtx } from "./deskCtx";
import { DSec, DimTag, DocHead, Empty, PrevNext, Strip, Text, VChip } from "./DocParts";
import { date, dur, hm, repoShort, signed, usd, verdictKey } from "./deskFormat";
import { LayerFrame } from "./LayerFrame";
import { batchOf, outcomeOf, reportOf, reportWord } from "./laneDocModel";
import { laneName, laneNav } from "./layerNav";
import { LaneFacts, LogTail, RescanPanel, VerifyPanel } from "./LaneDocSide";
import type { DeskRound } from "./roundsModel";
import l from "./deskLayers.module.css";
import s from "./desk.module.css";

const MEANS: Record<string, string> = {
  verified: "The repo's own check passed before and after.",
  rejected: "The change broke the repo's own check. Never delivered.",
  baseline: "The check could not run even before the change.",
  skipped: "The guard was skipped for this lane.",
  unknown: "A lane from before the guard existed. Unknown.",
};

export function LaneDoc({ ctx, round, detail, laneId }: { ctx: DeskCtx; round: DeskRound | null; detail: LoopRunDetail; laneId: string }) {
  const lane = detail.lanes.find((x) => x.id === laneId);
  const roundLabel = round?.label ?? (detail.run.seq != null ? `#${detail.run.seq}` : "round");
  const { prev, next } = laneNav(ctx.fold, laneId, "lane");
  const crumbsBase = [{ label: "Desk", to: null }, { label: `Round ${roundLabel}`, to: { kind: "round" as const, runId: detail.run.id } }];
  if (!lane)
    return (
      <LayerFrame crumbs={[...crumbsBase, { label: "Lane" }]} prev={prev} next={next} go={ctx.go} docKey={`lane:${laneId}`}>
        <div className={l.doc}>
          <Empty>This round has no lane with that id.</Empty>
        </div>
      </LayerFrame>
    );
  const name = laneName(lane.repoFullName, lane.cycle);
  const batch = batchOf(lane, detail.batchTitles);
  const report = reportOf(lane, detail.batchTitles);
  const o = outcomeOf(detail, lane.id);
  const overall = o?.diff?.overall ?? null;
  const errored = lane.phase === "error";
  const ds = lane.diffStat;

  return (
    <LayerFrame crumbs={[...crumbsBase, { label: name }]} prev={prev} next={next} go={ctx.go} docKey={`lane:${lane.id}`}>
      <div className={l.doc}>
        <DocHead
          kick={`Lane · round ${roundLabel} · ${lane.repoFullName}`}
          title={
            <>
              {repoShort(lane.repoFullName)} <span className={l.soft}>cycle {lane.cycle}</span>
              <VChip verdict={lane.verifyVerdict} errored={errored} />
            </>
          }
          sub={
            <>
              <span>{errored ? "The lane errored." : MEANS[verdictKey(lane.verifyVerdict)]}</span>
              <span className={l.dotsep}>|</span>
              <span className={s.mono}>
                {date(lane.startedAt)} {hm(lane.startedAt)}
              </span>
            </>
          }
          aside={
            <button type="button" className={s.btn} onClick={() => ctx.go({ kind: "log", runId: lane.runId, laneId: lane.id })}>
              Read the log · {lane.log.length} lines →
            </button>
          }
        />
        {lane.error ? (
          <div className={`${l.callout} ${l.red}`}>
            <b>Error</b>
            <span>{lane.error}</span>
          </div>
        ) : null}
        <Strip
          cells={[
            [`${lane.closedIds.length}/${batch.length}`, "verified closes", lane.closedIds.length ? s.green : undefined],
            [lane.commits, "commits"],
            [ds ? <><span className={s.green}>+{ds.plus}</span> <span className={s.red}>−{ds.minus}</span></> : "-", ds ? `${ds.files} files` : "diff not recorded"],
            [usd(lane.costMicros) ?? "n.r.", "cost", lane.costMicros == null ? s.faint : undefined],
            [overall ? signed(overall.delta) : "-", overall ? `lift · ${overall.before} → ${overall.after}` : "lift not measured", !overall ? s.faint : overall.delta > 0 ? s.green : overall.delta < 0 ? s.red : undefined],
            [lane.agentDurationMs ? dur(lane.agentDurationMs) : "-", "agent time"],
            [lane.turns ?? "-", "turns"],
          ]}
        />
        <div className={l.cols}>
          <div>
            {report.length ? (
              <DSec title="Report" count={report.length}>
                <div className={l.panel}>
                  {report.map((it) => {
                    const w = reportWord(it);
                    return (
                      <div key={it.id} className={l.item}>
                        <div className={l.h}>
                          <span className={`${l.vchip} ${l[w.key]}`}>{w.word}</span>
                          <DimTag id={it.dimId} />
                          <span>{it.title ?? it.id}</span>
                        </div>
                        {it.reason ? <Text className={l.b}>{it.reason}</Text> : null}
                        {it.files.length ? (
                          <div className={l.m}>
                            {it.files.slice(0, 8).map((f) => (
                              <span key={f} className={l.fileChip}>
                                {f}
                              </span>
                            ))}
                            {it.files.length > 8 ? <span className={`${s.faint} ${s.mono}`} style={{ fontSize: 12 }}>+{it.files.length - 8}</span> : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </DSec>
            ) : (
              <DSec title="Batch armed" count={batch.length}>
                <div className={l.panel}>
                  {batch.length === 0 ? <div className={l.empty}>No batch recorded.</div> : null}
                  {batch.map((b) => (
                    <div key={b.id} className={l.item}>
                      <div className={l.h}>
                        <span className={`${l.check} ${b.closed ? l.y : l.n}`}>{b.closed ? "✓" : "○"}</span>
                        <DimTag id={b.dimId} />
                        <span>{b.title ?? b.id}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </DSec>
            )}
            {lane.deliverables.filter((d) => !d.retired).length ? (
              <DSec title="Delivered" count={lane.deliverables.filter((d) => !d.retired).length}>
                <div className={l.panel}>
                  {lane.deliverables.filter((d) => !d.retired).map((d, i) => (
                    <div key={i} className={l.item}>
                      <div className={l.h}>
                        <DimTag id={d.dimId} />
                        <span>{d.headline}</span>
                      </div>
                      {d.evidence ? <div className={l.b}>{d.evidence}</div> : null}
                    </div>
                  ))}
                </div>
              </DSec>
            ) : null}
            {lane.report?.lessons.length ? (
              <DSec title="Lessons" count={lane.report.lessons.length}>
                <div className={l.panel}>
                  {lane.report.lessons.map((t, i) => (
                    <div key={i} className={l.item}>
                      <Text>{t}</Text>
                    </div>
                  ))}
                </div>
              </DSec>
            ) : null}
          </div>
          <div>
            <VerifyPanel lane={lane} />
            <RescanPanel outcome={o} />
            <LaneFacts lane={lane} roundLabel={roundLabel} go={ctx.go} />
            <LogTail lane={lane} go={ctx.go} />
          </div>
        </div>
        <PrevNext prev={prev} next={next} go={ctx.go} />
      </div>
    </LayerFrame>
  );
}
