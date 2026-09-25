"use client";

// The lane page's right column: the verify guard's verdict and command, the rescan by dimension, the
// lane's facts and the tail of its log. No hooks.

import type { LoopLaneOutcome, LoopLaneRecord } from "../cockpit/loopTypes";
import { DSec, DimTag, Empty, LogList, VChip } from "./DocParts";
import type { DeskRoute } from "./deskRoute";
import { DIM_NAMES, date } from "./deskFormat";
import { logLines } from "./laneDocModel";
import l from "./deskLayers.module.css";
import s from "./desk.module.css";

export function VerifyPanel({ lane }: { lane: LoopLaneRecord }) {
  return (
    <DSec title="Verify guard">
      <div className={l.panel}>
        <div className={l.item}>
          <div className={l.h}>
            <VChip verdict={lane.verifyVerdict} errored={lane.phase === "error"} />
            {lane.verifyRung ? (
              <span className={`${s.faint} ${s.mono}`} style={{ fontSize: 13 }}>
                {lane.verifyRung} rung
              </span>
            ) : null}
          </div>
          {lane.verifyCommand ? (
            <div className={`${l.b} ${s.mono}`} style={{ fontSize: 13, color: "var(--text)" }}>
              $ {lane.verifyCommand}
            </div>
          ) : null}
          {lane.verifyNote ? <div className={l.b}>{lane.verifyNote}</div> : null}
        </div>
      </div>
    </DSec>
  );
}

export function RescanPanel({ outcome }: { outcome: LoopLaneOutcome | null }) {
  const diff = outcome?.diff;
  if (!diff || diff.dimensions.length === 0) return null;
  return (
    <DSec title="Rescan by dimension">
      <div className={l.panel}>
        <table className={l.dimtbl}>
          <thead>
            <tr>
              <th>dim</th>
              <th className={l.n}>before</th>
              <th className={l.n}>after</th>
              <th className={l.dbar}>delta</th>
            </tr>
          </thead>
          <tbody>
            {diff.dimensions.map((d) => {
              const dd = d.delta ?? 0;
              const w = Math.min(50, Math.abs(dd) * 3);
              return (
                <tr key={d.id}>
                  <td>
                    <DimTag id={d.id} />{" "}
                    <span className={s.dim} style={{ fontSize: 13 }}>
                      {DIM_NAMES[d.id] ?? d.name}
                    </span>
                  </td>
                  <td className={l.n}>{d.before ?? "-"}</td>
                  <td className={l.n}>{d.after ?? "-"}</td>
                  <td>
                    <div className={l.deltabar} title={d.delta == null ? "not measured on both scans" : String(d.delta)}>
                      <i style={{ ...(dd >= 0 ? { left: "50%" } : { right: "50%" }), width: `${w}%`, background: dd > 0 ? "var(--green)" : dd < 0 ? "var(--red)" : "transparent" }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className={`${l.empty} ${s.mono}`} style={{ fontSize: 13 }}>
          gaps closed {diff.closedGapCount} · opened {diff.openedGapCount}
        </div>
      </div>
    </DSec>
  );
}

export function LaneFacts({ lane, roundLabel, go }: { lane: LoopLaneRecord; roundLabel: string; go: (to: DeskRoute) => void }) {
  const tokens = lane.inputTokens != null ? `${lane.inputTokens.toLocaleString("en-US")} / ${(lane.outputTokens ?? 0).toLocaleString("en-US")}` : "-";
  return (
    <DSec title="Lane facts">
      <div className={l.panel}>
        <dl className={l.dl}>
          <dt>round</dt>
          <dd>
            <button type="button" className={l.fileChip} onClick={() => go({ kind: "round", runId: lane.runId })}>
              {roundLabel}
            </button>
          </dd>
          <dt>branch</dt>
          <dd>{lane.branch ?? "-"}</dd>
          <dt>model</dt>
          <dd>{lane.model ?? "not recorded"}</dd>
          {lane.planModel ? (
            <>
              <dt>planner</dt>
              <dd>{lane.planModel}</dd>
            </>
          ) : null}
          <dt>tokens in/out</dt>
          <dd>{tokens}</dd>
          <dt>landing</dt>
          <dd>{lane.landedAt ? `landed ${date(lane.landedAt)}` : "not landed"}</dd>
        </dl>
      </div>
    </DSec>
  );
}

export function LogTail({ lane, go }: { lane: LoopLaneRecord; go: (to: DeskRoute) => void }) {
  const tail = logLines(lane.log.slice(-4));
  return (
    <DSec
      title="Log tail"
      right={
        <button type="button" className={l.fileChip} onClick={() => go({ kind: "log", runId: lane.runId, laneId: lane.id })}>
          all {lane.log.length} lines →
        </button>
      }
    >
      {tail.length ? <LogList lines={tail} preview /> : <Empty>No log recorded.</Empty>}
    </DSec>
  );
}
