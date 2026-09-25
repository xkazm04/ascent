"use client";

// 03 THE ROUNDS — five figures, the flight log, its legend, and the last-rounds table underneath. The
// log and the table share one selected round; both open it. A failed read says so instead of drawing
// an empty chart.

import { useState } from "react";
import { Tip } from "./DeskTip";
import type { DeskCtx } from "./deskCtx";
import { date, usd0 } from "./deskFormat";
import { FlightLog } from "./FlightLog";
import { RoundsTable } from "./RoundsTable";
import type { DeskRound, RoundsFold } from "./roundsModel";
import r from "./deskRounds.module.css";
import s from "./desk.module.css";

function Figures({ fold, more }: { fold: RoundsFold; more: boolean }) {
  const T = fold.totals;
  const bound = more ? " Older rounds exist beyond this read, so every total is a lower bound." : "";
  return (
    <div className={r.figs}>
      <div className={r.fig}>
        <b className={s.green}>{T.closes}</b>
        <span>
          verified closes <Tip text={`Only a gap the rescan adjudicated closed counts. An agent's claim is not a close.${bound}`} />
        </span>
      </div>
      <div className={r.fig}>
        <b>{T.costKnown ? usd0(T.costMicros) : "—"}</b>
        <span>
          reported <Tip text={`${T.costUnknown} of ${T.lanes} lanes recorded no cost. They are unknown, never $0, so this sum is partial.`} />
        </span>
      </div>
      <div className={r.fig}>
        <b className={s.red}>{T.verdicts.rejected}</b>
        <span>
          rejected <Tip text="The change broke the repo's own check. Never delivered." />
        </span>
      </div>
      <div className={r.fig}>
        <b className={s.faint}>{T.verdicts.unknown}</b>
        <span>
          unknown verdicts <Tip text="Lanes from before the A/B guard existed. Unknown, never read as skipped or passed." />
        </span>
      </div>
      <div className={r.fig}>
        <b>{T.landed}</b>
        <span>
          landed <Tip text="Lanes whose verified work was delivered onto the runner branch." />
        </span>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className={r.legend}>
      <span><i className={r.sw} style={{ background: "#37cf8c" }} />verified closes</span>
      <span><i className={r.sw} style={{ background: "#4d9dff" }} />reported $</span>
      <span><i className={r.sw} style={{ border: "1px dashed #56617a" }} />$ not reported</span>
      <span><i className={r.sw} style={{ background: "#8fb4e8", height: 2 }} />cumulative closes</span>
      <span style={{ color: "var(--faint)" }}>lanes:</span>
      <span><i className={r.dot} style={{ background: "#37cf8c" }} />verified</span>
      <span><i className={r.dot} style={{ background: "#ff5f5f" }} />rejected</span>
      <span><i className={r.dot} style={{ background: "#f3b23a" }} />no baseline</span>
      <span><i className={r.dot} style={{ boxShadow: "inset 0 0 0 1.5px #6b7892" }} />unknown</span>
      <span><b className={s.red} style={{ fontWeight: 700 }}>×</b>errored</span>
      <span><b className={s.green}>▲</b>lift</span>
    </div>
  );
}

export function RoundsSection({ ctx }: { ctx: DeskCtx }) {
  const { fold, data, go } = ctx;
  const [sel, setSel] = useState(() => (fold ? fold.rounds.length - 1 : 0));
  const open = (round: DeskRound | undefined) => round && go({ kind: "round", runId: round.id });
  const T = fold?.totals;

  return (
    <section className={s.sec} data-role="desk-sec" aria-labelledby="desk-h-rounds">
      <div className={s.sechead}>
        <h2 id="desk-h-rounds" data-role="desk-sechead">
          <span className={s.idx}>03</span>The rounds
        </h2>
        <span className={s.count}>{T && T.runs ? `${T.runs}${data.roundsHasMore ? "+" : ""} rounds · ${date(T.firstMs)} → ${date(T.lastMs)}` : ""}</span>
        {fold && fold.rounds.length ? <Figures fold={fold} more={data.roundsHasMore} /> : null}
      </div>
      {!fold ? (
        <div className={s.unread} data-testid="desk-rounds-unread">
          Could not read the rounds — reload to retry.
        </div>
      ) : fold.rounds.length === 0 ? (
        <div className={s.quiet}>
          No round yet. <a href={ctx.hrefs.cockpit}>Set one up in the Cockpit →</a>
        </div>
      ) : (
        <>
          {data.lanes == null ? <div className={s.unread}>Could not read the lanes — verdict marks are missing, not zero.</div> : null}
          <FlightLog fold={fold} sel={sel} setSel={setSel} onOpen={(i) => open(fold.rounds[i])} />
          <Legend />
          <RoundsTable rounds={fold.rounds} onOpen={open} onHover={(round) => setSel(fold.rounds.indexOf(round))} />
        </>
      )}
    </section>
  );
}
