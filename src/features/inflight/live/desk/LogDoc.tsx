"use client";

// THE LOG PAGE — every line the lane kept, marked good / warning / failure, and the agent's activity
// stream when one was recorded. Prev/next walks the logs of every lane in history. No hooks.

import type { LoopRunDetail } from "../cockpit/loopTypes";
import type { DeskCtx } from "./deskCtx";
import { DSec, DocHead, Empty, LogList, PrevNext, Strip, VChip } from "./DocParts";
import { hms, repoShort } from "./deskFormat";
import { LayerFrame } from "./LayerFrame";
import { logCounts, logLines, type LogLine } from "./laneDocModel";
import { laneName, laneNav } from "./layerNav";
import type { DeskRound } from "./roundsModel";
import l from "./deskLayers.module.css";
import s from "./desk.module.css";

const ACTIVITY_MAX = 40;

export function LogDoc({ ctx, round, detail, laneId }: { ctx: DeskCtx; round: DeskRound | null; detail: LoopRunDetail; laneId: string }) {
  const lane = detail.lanes.find((x) => x.id === laneId);
  const roundLabel = round?.label ?? (detail.run.seq != null ? `#${detail.run.seq}` : "round");
  const { prev, next } = laneNav(ctx.fold, laneId, "log");
  const roundCrumb = { label: `Round ${roundLabel}`, to: { kind: "round" as const, runId: detail.run.id } };
  if (!lane)
    return (
      <LayerFrame crumbs={[{ label: "Desk", to: null }, roundCrumb, { label: "Log" }]} prev={prev} next={next} go={ctx.go} docKey={`log:${laneId}`}>
        <div className={`${l.doc} ${l.narrow}`}>
          <Empty>This round has no lane with that id.</Empty>
        </div>
      </LayerFrame>
    );
  const lines = logLines(lane.log);
  const k = logCounts(lines);
  const name = laneName(lane.repoFullName, lane.cycle);
  const activity: LogLine[] = (lane.activity ?? []).slice(-ACTIVITY_MAX).map((a) => ({
    t: hms(a.at),
    text: a.path ? `${a.tool ?? a.kind} ${a.path}` : (a.note ?? a.kind),
    kind: "info",
  }));

  return (
    <LayerFrame
      crumbs={[{ label: "Desk", to: null }, roundCrumb, { label: name, to: { kind: "lane", runId: lane.runId, laneId: lane.id } }, { label: "Log" }]}
      prev={prev}
      next={next}
      go={ctx.go}
      docKey={`log:${lane.id}`}
    >
      <div className={`${l.doc} ${l.narrow}`}>
        <DocHead
          kick={`Log · last ${lines.length} lines kept`}
          title={
            <>
              {repoShort(lane.repoFullName)}{" "}
              <span className={l.soft}>
                cycle {lane.cycle} · {roundLabel}
              </span>
              <VChip verdict={lane.verifyVerdict} errored={lane.phase === "error"} />
            </>
          }
          aside={
            <button type="button" className={s.btn} onClick={() => ctx.go({ kind: "lane", runId: lane.runId, laneId: lane.id })}>
              ← Lane report
            </button>
          }
        />
        <Strip
          cells={[
            [lines.length, "lines"],
            [lines[0]?.t || "-", "first line"],
            [lines[lines.length - 1]?.t || "-", "last line"],
            [k.good, "verified lines", k.good ? s.green : s.faint],
            [k.warn, "warnings", k.warn ? s.amber : s.faint],
            [k.bad, "failures", k.bad ? s.red : s.faint],
          ]}
        />
        <DSec title="Lines">{lines.length ? <LogList lines={lines} /> : <Empty>No log recorded for this lane.</Empty>}</DSec>
        {activity.length ? (
          <DSec title="Activity stream" count={lane.activity?.length ?? 0}>
            <LogList lines={activity} />
          </DSec>
        ) : null}
        <PrevNext prev={prev} next={next} go={ctx.go} />
      </div>
    </LayerFrame>
  );
}
