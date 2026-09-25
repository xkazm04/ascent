"use client";

// 04 ARM LEAGUE — one card per arm: its closes with a bar, the verdict mix per lane, $ per verified
// close with its n. Nothing is ranked by value (a figure exists only for priced arms). No hooks.

import { Tip } from "./DeskTip";
import type { DeskCtx } from "./deskCtx";
import { usd } from "./deskFormat";
import { seqRange, type ArmRow } from "./armsModel";
import r from "./deskRounds.module.css";
import s from "./desk.module.css";

const MIX: [keyof ArmRow["verdicts"], string, string][] = [
  ["verified", "✓", s.green!],
  ["baseline", "no base", s.amber!],
  ["rejected", "rej", s.red!],
  ["unknown", "unk", s.faint!],
];

function Arm({ a, max, onOpen }: { a: ArmRow; max: number; onOpen: () => void }) {
  const segs = (["verified", "rejected", "baseline", "skipped", "unknown"] as const).filter((k) => a.verdicts[k]);
  return (
    <button type="button" className={r.arm} data-role="desk-arm" onClick={onOpen}>
      <span className={r.nm}>
        {a.exec}
        {a.plan ? <span className={r.pl}>plan {a.plan}</span> : null}
        <span className={r.rs}>
          {a.lanes} lanes {seqRange(a) ? `· ${seqRange(a)}` : ""}
        </span>
      </span>
      <span className={`${r.big} ${a.closes ? s.green : s.faint}`}>
        {a.closes}
        <small>
          <span className={`${s.bar} ${r.bar ?? ""}`}>
            <i style={{ width: `${max ? (a.closes / max) * 100 : 0}%`, background: "#37cf8c" }} />
          </span>
        </small>
      </span>
      <span className={r.mix}>
        <span className={r.mixbar}>
          {segs.map((k) => (
            <i key={k} className={r[k]} style={{ width: `${(a.verdicts[k] / a.lanes) * 100}%` }} />
          ))}
        </span>
        <span className={r.mixlab}>
          {MIX.filter(([k]) => a.verdicts[k]).map(([k, w, tone]) => (
            <span key={k}>
              <b className={tone}>{a.verdicts[k]}</b> {w}
            </span>
          ))}
          {a.errors ? (
            <span>
              <b className={s.red}>{a.errors}</b> err
            </span>
          ) : null}
        </span>
      </span>
      <span className={r.per}>
        {a.perCloseMicros != null ? (
          <>
            <b>{usd(a.perCloseMicros)}</b>
            <span>n={a.costLanes} priced</span>
          </>
        ) : (
          <>
            <b className={s.faint}>-</b>
            <span>{a.costLanes ? `${a.costLanes} priced` : "unpriced"}</span>
          </>
        )}
      </span>
    </button>
  );
}

export function ArmLeague({ ctx }: { ctx: DeskCtx }) {
  const { arms, fold, go } = ctx;
  const max = Math.max(0, ...arms.map((a) => a.closes));
  return (
    <section className={s.sec} data-role="desk-sec" aria-labelledby="desk-h-league">
      <div className={s.sechead}>
        <h2 id="desk-h-league" data-role="desk-sechead">
          <span className={s.idx}>04</span>Arm league
        </h2>
        <span className={s.count}>{fold ? `${arms.length} arms · ${fold.totals.lanes} lanes` : ""}</span>
        <Tip text="What a lane ran on. $ per verified close counts only lanes with a recorded cost, and only their closes; unknown cost is never $0. Nothing is ranked by value." />
      </div>
      {!fold || ctx.data.lanes == null ? (
        <div className={s.unread}>Could not read the lanes — reload to retry.</div>
      ) : arms.length === 0 ? (
        <div className={s.quiet}>No lane has run yet.</div>
      ) : (
        <>
          <div className={r.leaguehead}>
            <span className={s.cap}>Arm</span>
            <span className={s.cap}>Verified closes</span>
            <span className={s.cap}>Verdicts per lane</span>
            <span className={s.cap}>$ / close</span>
          </div>
          <div className={r.league}>
            {arms.map((a) => (
              <Arm key={a.key} a={a} max={max} onOpen={() => go({ kind: "arm", key: a.key })} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
