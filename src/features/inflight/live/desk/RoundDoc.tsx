// THE ROUND PAGE — the heading block, a figure strip, lane cards, what was delivered beside the batches
// armed, the lessons, the setup; prev/next walks the rounds in time. No hooks.

import type { LoopRunDetail } from "../cockpit/loopTypes";
import type { DeskCtx } from "./deskCtx";
import { DocHead, PrevNext, Strip } from "./DocParts";
import { date, dur, hm, repoShort, signed, toMs, usd } from "./deskFormat";
import { LayerFrame } from "./LayerFrame";
import { orderedLanes } from "./laneDocModel";
import { roundNav } from "./layerNav";
import { Pips } from "./Pips";
import { DeliveredAndBatches, LaneCards, RoundLessons, RoundSetup } from "./RoundDocParts";
import type { DeskRound } from "./roundsModel";
import l from "./deskLayers.module.css";
import s from "./desk.module.css";

export function RoundDoc({ ctx, round, detail }: { ctx: DeskCtx; round: DeskRound | null; detail: LoopRunDetail }) {
  const run = detail.run;
  const label = round?.label ?? (run.seq != null ? `#${run.seq}` : run.startedAt.slice(0, 10));
  const lanes = orderedLanes(detail);
  const { prev, next } = roundNav(ctx.fold, run.id);
  const start = toMs(run.startedAt);
  const end = toMs(run.endedAt);
  const commits = lanes.reduce((n, x) => n + x.commits, 0);
  const verified = lanes.filter((x) => x.verifyVerdict === "verified").length;
  const costKnown = lanes.filter((x) => x.costMicros != null);
  const cost = costKnown.length ? costKnown.reduce((n, x) => n + (x.costMicros ?? 0), 0) : null;
  const unpriced = lanes.length - costKnown.length;
  const delivered = lanes.reduce((n, x) => n + x.deliverables.filter((d) => !d.retired).length, 0);
  const closes = round?.closes ?? lanes.reduce((n, x) => n + x.closedIds.length, 0);
  const lift = round?.lift ?? null;
  const error = round?.error ?? run.error;

  return (
    <LayerFrame crumbs={[{ label: "Desk", to: null }, { label: `Round ${label}` }]} prev={prev} next={next} go={ctx.go} docKey={`round:${run.id}`}>
      <div className={l.doc}>
        <DocHead
          kick={`Round${round ? ` · chapter ${round.chapter}` : ""}`}
          title={
            <>
              Round <span>{label}</span>
              <span className={`${l.vchip} ${run.phase === "done" ? l.done : l.baseline}`}>{run.phase}</span>
            </>
          }
          sub={
            <>
              <span style={{ fontFamily: "var(--desk-mono)" }}>
                {date(start)} {hm(start)}
                {end != null ? ` → ${hm(end)}` : ""}
              </span>
              <span className={l.dotsep}>|</span>
              <span>{start != null && end != null ? dur(end - start) : "still running"}</span>
              <span className={l.dotsep}>|</span>
              <span>{run.repos.map(repoShort).join(", ")}</span>
            </>
          }
          aside={round ? <Pips lanes={round.lanes} /> : null}
        />
        {error ? (
          <div className={`${l.callout} ${l.red}`}>
            <b>Run error</b>
            <span>{error}</span>
          </div>
        ) : null}
        <Strip
          cells={[
            [closes, "verified closes", closes ? s.green : undefined],
            [usd(cost) ?? "n.r.", unpriced ? `reported · ${unpriced} lanes n.r.` : "reported $", cost == null ? s.faint : undefined],
            [lanes.length, `lanes · ${run.maxCycles} cycles max`],
            [lanes.length ? `${verified}/${lanes.length}` : "-", "verified verdicts"],
            [commits, "commits"],
            [delivered, "deliverables"],
            [lift == null ? "-" : signed(lift), lift == null ? "lift not measured" : "lift", lift == null || lift === 0 ? s.faint : lift > 0 ? s.green : s.red],
          ]}
        />
        <LaneCards lanes={lanes} detail={detail} go={ctx.go} />
        <DeliveredAndBatches lanes={lanes} detail={detail} go={ctx.go} />
        <RoundLessons lanes={lanes} go={ctx.go} />
        <RoundSetup detail={detail} />
        <PrevNext prev={prev} next={next} go={ctx.go} />
      </div>
    </LayerFrame>
  );
}
