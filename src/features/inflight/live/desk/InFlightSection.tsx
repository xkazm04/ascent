// 02 IN FLIGHT — the live pulse: a four-answer strip (running? / now / today / needs you), one row per
// lane, and the repos waiting for a slot. The feed is the Theater's own transport; a stale feed LOOKS
// stale (the strip says "Reconnecting…", the rows dim), and with no runner and no run the section is
// one short line. No hooks here (the parent owns the feed), so no "use client".

import type { ReactNode } from "react";
import { Tip } from "./DeskTip";
import type { DeskCtx } from "./deskCtx";
import { dur, repoShort } from "./deskFormat";
import { flightView, serverClock } from "./inFlightModel";
import { InFlightLanes } from "./InFlightLanes";
import type { TheaterFeed } from "../theater/useTheaterPulse";
import s from "./desk.module.css";

const TONE: Record<string, string | undefined> = { warn: s.warn, muted: s.muted, calm: s.muted, danger: s.danger, live: "" };

function Line({ children, tone = "quiet" }: { children: ReactNode; tone?: "quiet" | "unread" }) {
  return (
    <div className={tone === "unread" ? s.unread : s.quiet} data-testid="desk-flight-line">
      {children}
    </div>
  );
}

export function InFlightSection({ ctx, feed, stale }: { ctx: DeskCtx; feed: TheaterFeed; stale: boolean }) {
  const p = feed.pulse;
  const heardAgo = feed.receivedAt != null ? feed.now - feed.receivedAt : null;
  const view = p ? flightView(p, serverClock(p, feed.receivedAt, feed.now, stale), stale, heardAgo) : null;
  const src = !feed.loaded ? (stale ? "no answer" : "listening") : stale ? `stale · ${heardAgo != null ? dur(heardAgo) : "?"}` : "live · 2 s pulse";
  const empty = p != null && !p.runner && !p.run && p.lanes.length === 0;
  const planRepos = new Set(ctx.waiting.plans?.map((x) => x.repo) ?? []);

  let body: ReactNode;
  if (!feed.loaded) body = stale ? <Line tone="unread">No answer from the pulse{feed.error ? ` — ${feed.error}` : ""}</Line> : <Line>Listening for the runner…</Line>;
  else if (!p || empty)
    body = (
      <Line>
        No runner, no run in flight. <a href={ctx.hrefs.cockpit}>Start one in the Cockpit →</a>
      </Line>
    );
  else if (view)
    body = (
      <>
        <div className={s.answers} data-role="desk-answers">
          <div>
            <span className={s.cap}>Running?</span>
            <div className={`${s.v} ${TONE[view.running.tone]}`} data-role="desk-answer-v" data-testid="desk-running">
              {view.running.headline}
            </div>
            <div className={s.money}>{view.running.sub ?? ""}</div>
          </div>
          <div>
            <span className={s.cap}>Now</span>
            <div className={`${s.v} ${TONE[view.now.tone]}`} data-role="desk-answer-v">
              {view.now.headline}
            </div>
            <div className={s.money}>{view.now.sub ?? ""}</div>
          </div>
          <div>
            <span className={s.cap}>Today</span>
            <div className={s.v} data-role="desk-answer-v">
              <span className={`${s.green} ${s.num}`}>{view.today.verified}</span> <small>verified</small>&nbsp; <span className={s.num}>{view.today.landed}</span> <small>landed</small>
            </div>
            <div className={s.money}>
              <span className={s.cap}>money used</span>
              {view.today.ratio != null ? (
                <span className={`${s.bar} ${view.today.ratio > 0.8 ? s.hot : ""}`}>
                  <i style={{ width: `${(view.today.ratio * 100).toFixed(1)}%` }} />
                </span>
              ) : null}
              <b>{view.today.spend}</b>
              {view.today.ceiling ? ` of ${view.today.ceiling}` : " · no ceiling"}
            </div>
          </div>
          <div>
            <span className={s.cap}>Needs you</span>
            <div className={`${s.v} ${view.needs.count ? s.warn : s.muted}`} data-role="desk-answer-v">
              {view.needs.headline}
            </div>
            <div className={s.money}>{view.needs.count ? <a href={`${ctx.hrefs.ledger}#ledger-needs-you`}>open the Ledger →</a> : "inbox clear"}</div>
          </div>
        </div>
        <InFlightLanes view={view} pulseLanes={p.lanes} stale={stale} />
        <div className={s.waitrow}>
          <span className={s.cap} style={{ marginRight: 6 }}>
            Waiting for a slot
          </span>
          {view.waiting.length ? (
            view.waiting.map((r) => (
              <span key={r} className={`${s.chip} ${planRepos.has(r) ? s.amber : ""}`} data-role="desk-chip">
                {repoShort(r)}
                {planRepos.has(r) ? " · plan waits" : ""}
              </span>
            ))
          ) : (
            <span className={s.faint}>none</span>
          )}
          {view.arm ? (
            <span className={s.chip} style={{ marginLeft: "auto" }} data-role="desk-chip" title="the arm the lanes run on">
              arm {view.arm}
            </span>
          ) : null}
        </div>
      </>
    );

  return (
    <section className={`${s.sec} ${stale ? s.isStale : ""}`} data-role="desk-sec" aria-labelledby="desk-h-flight" data-stale={stale || undefined}>
      <div className={s.sechead}>
        <h2 id="desk-h-flight" data-role="desk-sechead">
          <span className={s.idx}>02</span>In flight
        </h2>
        <span className={s.count}>{view?.runLabel ?? ""}</span>
        <div className={s.right}>
          <span className={`${s.src} ${stale || (!feed.loaded && stale) ? s.stale : s.live}`} data-role="desk-chip">
            {src}
          </span>
          <Tip text="The runner's live pulse, read every 2 s while this tab is visible. Stale after 10 s without an answer. Bars are time used against the lane deadline, never work done." />
          <a className={`${s.btn} ${s.sm}`} href={ctx.hrefs.onAir} target="_blank" rel="noopener">
            Watch ↗
          </a>
        </div>
      </div>
      {body}
    </section>
  );
}
