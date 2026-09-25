"use client";

// The round page's body: lane cards, delivered headlines beside the batches armed, the lessons the
// lanes wrote, and the round's setup. No hooks.

import type { LoopLaneRecord, LoopRunDetail } from "../cockpit/loopTypes";
import { DSec, DimTag, Empty, Text, VChip } from "./DocParts";
import type { DeskRoute } from "./deskRoute";
import { dur, repoShort, toMs, usd } from "./deskFormat";
import { batchOf, deliveredOf } from "./laneDocModel";
import { laneName } from "./layerNav";
import l from "./deskLayers.module.css";
import s from "./desk.module.css";

type Go = (to: DeskRoute) => void;
const laneTo = (x: LoopLaneRecord): DeskRoute => ({ kind: "lane", runId: x.runId, laneId: x.id });

export function agentTime(x: LoopLaneRecord): string {
  if (x.agentDurationMs) return dur(x.agentDurationMs);
  const a = toMs(x.startedAt);
  const b = toMs(x.endedAt);
  return a != null && b != null ? dur(b - a) : "-";
}

export function LaneCards({ lanes, detail, go }: { lanes: LoopLaneRecord[]; detail: LoopRunDetail; go: Go }) {
  return (
    <DSec title="Lanes" count={lanes.length} right={<span className={s.faint}>open one for its report and log</span>}>
      {lanes.length === 0 ? <Empty>No lane recorded.</Empty> : null}
      <div className={l.lanecards}>
        {lanes.map((x) => {
          const batch = batchOf(x, detail.batchTitles);
          const closes = x.closedIds.length;
          return (
            <button key={x.id} type="button" className={l.lanecard} onClick={() => go(laneTo(x))} data-testid="desk-lanecard">
              <div className={l.top1}>
                <b>
                  {repoShort(x.repoFullName)}
                  <small>cycle {x.cycle}</small>
                </b>
                <VChip verdict={x.verifyVerdict} errored={x.phase === "error"} />
              </div>
              <div className={l.closebar} title={`${closes} of ${batch.length} follow-ups closed`}>
                {(batch.length ? batch : [null]).map((b, i) => (
                  <i key={i} className={b?.closed ? l.y : ""} />
                ))}
              </div>
              <div className={l.fig3}>
                <div>
                  <b className={closes ? s.green : s.faint}>
                    {closes}/{batch.length}
                  </b>
                  <span>closed</span>
                </div>
                <div>
                  <b>{usd(x.costMicros) ?? <span className={s.faint}>n.r.</span>}</b>
                  <span>cost</span>
                </div>
                <div>
                  <b>{agentTime(x)}</b>
                  <span>agent time</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </DSec>
  );
}

export function DeliveredAndBatches({ lanes, detail, go }: { lanes: LoopLaneRecord[]; detail: LoopRunDetail; go: Go }) {
  const delivered = deliveredOf(lanes);
  return (
    <div className={l.cols}>
      <DSec title="Delivered" count={delivered.length}>
        {delivered.length ? (
          <div className={l.panel}>
            {delivered.map(({ lane, d }, i) => (
              <div key={i} className={l.item}>
                <div className={l.h}>
                  <DimTag id={d.dimId} />
                  <span>{d.headline}</span>
                </div>
                <div className={l.m}>
                  <button type="button" className={l.fileChip} onClick={() => go(laneTo(lane))}>
                    {laneName(lane.repoFullName, lane.cycle)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No deliverable headline recorded.</Empty>
        )}
      </DSec>
      <DSec title="Batches armed">
        <div className={l.panel}>
          {lanes.length === 0 ? <div className={l.empty}>No batch recorded.</div> : null}
          {lanes.map((x) => {
            const batch = batchOf(x, detail.batchTitles);
            return (
              <div key={x.id} className={l.item}>
                <button type="button" className={l.h} onClick={() => go(laneTo(x))}>
                  {laneName(x.repoFullName, x.cycle)}{" "}
                  <span className={`${s.faint} ${s.mono}`} style={{ fontSize: 13, fontWeight: 400 }}>
                    {x.closedIds.length}/{batch.length} closed
                  </span>
                </button>
                {batch.map((b) => (
                  <div key={b.id} className={`${l.b} ${l.batchLine}`}>
                    <span className={`${l.check} ${b.closed ? l.y : l.n}`}>{b.closed ? "✓" : "○"}</span>
                    <DimTag id={b.dimId} />
                    <span>{b.title ?? b.id}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </DSec>
    </div>
  );
}

export function RoundLessons({ lanes, go }: { lanes: LoopLaneRecord[]; go: Go }) {
  const lessons = lanes.flatMap((lane) => (lane.report?.lessons ?? []).map((text) => ({ lane, text })));
  if (!lessons.length) return null;
  return (
    <DSec title="Lessons" count={lessons.length}>
      <div className={`${l.panel} ${l.lgrid}`}>
        {lessons.map(({ lane, text }, i) => (
          <div key={i} className={l.item}>
            <Text>{text}</Text>
            <div className={l.m}>
              <button type="button" className={l.fileChip} onClick={() => go(laneTo(lane))}>
                {laneName(lane.repoFullName, lane.cycle)}
              </button>
            </div>
          </div>
        ))}
      </div>
    </DSec>
  );
}

export function RoundSetup({ detail }: { detail: LoopRunDetail }) {
  const run = detail.run;
  const models = [...new Set(detail.lanes.map((x) => x.model).filter((m): m is string => !!m))];
  const arms = (run.arms ?? []).map((a) => a.label ?? a.id);
  const cell = (v: string | number | null | undefined) => (v == null || v === "" ? "-" : String(v));
  return (
    <DSec title="Setup">
      <div className={l.panel}>
        <dl className={`${l.dl} ${l.wide}`}>
          <dt>verify</dt>
          <dd>{cell(run.verifyMode)}</dd>
          <dt>plan mode</dt>
          <dd>{cell(run.planMode)}</dd>
          <dt>delivery</dt>
          <dd>{cell(run.delivery)}</dd>
          <dt>concurrency</dt>
          <dd>{cell(run.concurrency)}</dd>
          <dt>batch</dt>
          <dd>{cell(run.batchSize)}</dd>
          <dt>{arms.length ? "arms" : "model"}</dt>
          <dd>{arms.length ? arms.join(", ") : models.join(", ") || run.model || "not recorded"}</dd>
        </dl>
      </div>
    </DSec>
  );
}
