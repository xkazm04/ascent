"use client";

// An arm's page — its figures and every lane it ran, newest first; a row opens the lane. No hooks.

import type { DeskCtx } from "./deskCtx";
import { DSec, DocHead, Empty, PrevNext, Strip, VChip } from "./DocParts";
import { dur, toMs, usd } from "./deskFormat";
import { seqRange } from "./armsModel";
import { LayerFrame } from "./LayerFrame";
import { allLanes, armNav, laneName } from "./layerNav";
import r from "./deskRounds.module.css";
import l from "./deskLayers.module.css";
import s from "./desk.module.css";

export function ArmDoc({ ctx, armKey }: { ctx: DeskCtx; armKey: string }) {
  const a = ctx.arms.find((x) => x.key === armKey);
  const { prev, next } = armNav(ctx.arms, armKey);
  const crumbs = [{ label: "Desk", to: null }, { label: "Arm league", to: null }, { label: armKey }];
  if (!a)
    return (
      <LayerFrame crumbs={crumbs} prev={prev} next={next} go={ctx.go} docKey={`arm:${armKey}`}>
        <div className={l.doc}>
          <Empty>No lane in the rounds read ran on this arm.</Empty>
        </div>
      </LayerFrame>
    );
  const byId = new Map(allLanes(ctx.fold).map((x) => [x.lane.id, x]));
  const lanes = a.laneIds.map((id) => byId.get(id)).filter((x) => x != null);

  return (
    <LayerFrame crumbs={crumbs} prev={prev} next={next} go={ctx.go} docKey={`arm:${armKey}`}>
      <div className={l.doc}>
        <DocHead
          kick={`Arm · ${a.plan ? "split: plan with one model, execute with another" : "one model plans and executes"}`}
          title={a.key}
          mono
          sub={seqRange(a) ? <span>rounds {seqRange(a)}</span> : null}
        />
        <Strip
          cells={[
            [a.lanes, "lanes"],
            [a.closes, "verified closes", s.green],
            [a.costLanes ? usd(a.costMicros) : "n.r.", `${a.costLanes} of ${a.lanes} lanes priced`, a.costLanes ? undefined : s.faint],
            [a.perCloseMicros != null ? usd(a.perCloseMicros) : "-", a.perCloseMicros != null ? "$ per verified close" : "no $ per close figure", a.perCloseMicros != null ? undefined : s.faint],
            [a.verdicts.rejected, "rejected", a.verdicts.rejected ? s.red : s.faint],
            [a.errors, "errored", a.errors ? s.red : s.faint],
          ]}
        />
        {a.perCloseMicros == null ? (
          <div className={l.callout}>
            <b>No figure</b>
            <span>{a.costLanes ? "Its priced lanes closed nothing, so $ per close is undefined." : "No lane of this arm recorded a cost. Unknown is never $0."}</span>
          </div>
        ) : null}
        <DSec title="Lanes" count={lanes.length}>
          <table className={r.tbl}>
            <thead>
              <tr>
                <th>Round</th>
                <th>Lane</th>
                <th>Verdict</th>
                <th className={r.n}>Closes</th>
                <th className={r.n}>Cost</th>
                <th className={r.n}>Took</th>
              </tr>
            </thead>
            <tbody>
              {lanes.map(({ lane, label }) => {
                const a0 = toMs(lane.startedAt);
                const b0 = toMs(lane.endedAt);
                return (
                  <tr key={lane.id} tabIndex={0} onClick={() => ctx.go({ kind: "lane", runId: lane.runId, laneId: lane.id })} onKeyDown={(e) => e.key === "Enter" && ctx.go({ kind: "lane", runId: lane.runId, laneId: lane.id })}>
                    <td className={r.seq}>{label}</td>
                    <td>{laneName(lane.repo, lane.cycle)}</td>
                    <td>
                      <VChip verdict={lane.verdict} errored={lane.errored} />
                    </td>
                    <td className={`${r.n} ${lane.closes ? s.green : s.faint}`}>{lane.closes}</td>
                    <td className={r.n}>{usd(lane.costMicros) ?? <span className={r.unk}>n.r.</span>}</td>
                    <td className={r.n}>{a0 != null && b0 != null ? dur(b0 - a0) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DSec>
        <PrevNext prev={prev} next={next} go={ctx.go} />
      </div>
    </LayerFrame>
  );
}
