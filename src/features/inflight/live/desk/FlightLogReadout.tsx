// The flight log's hover readout — one round's figures, beside its column. No hooks.

import { date, hm, signed, usd } from "./deskFormat";
import { verdictMix, type DeskRound } from "./roundsModel";
import r from "./deskRounds.module.css";
import s from "./desk.module.css";

const W = 240;

export function Readout({ round, cx, wrapWidth }: { round: DeskRound; cx: number; wrapWidth: number }) {
  const left = cx + 16 + W > wrapWidth - 8 ? cx - 16 - W : cx + 16;
  const cost = usd(round.costMicros);
  return (
    <div className={r.readout} style={{ left, top: 40, width: W }} data-testid="desk-readout">
      <h4>
        Round {round.label}{" "}
        <small>
          {date(round.startMs)} {hm(round.startMs)}
        </small>
      </h4>
      <dl>
        <dt>verified closes</dt>
        <dd className={s.green}>{round.closes}</dd>
        <dt>reported $</dt>
        <dd>
          {cost ? (
            <>
              {cost}
              {round.costUnknown ? ` +${round.costUnknown} n.r.` : ""}
            </>
          ) : (
            <span className={s.faint}>not reported</span>
          )}
        </dd>
        <dt>lanes</dt>
        <dd>
          {round.lanesKnown ? round.lanes.length : "?"}
          {round.errors ? <span className={s.red}> · {round.errors} err</span> : null}
        </dd>
        <dt>verdicts</dt>
        <dd>{round.lanesKnown ? verdictMix(round.verdicts) || "-" : "could not read"}</dd>
        <dt>lift</dt>
        <dd>{round.lift == null ? <span className={s.faint}>not measured</span> : signed(round.lift)}</dd>
      </dl>
      <div className={r.hint}>click to open →</div>
    </div>
  );
}
