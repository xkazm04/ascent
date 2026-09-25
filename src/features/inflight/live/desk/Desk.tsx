"use client";

// THE DESK (beta) — the Live tab's graphical overview (contest live-fleet-rounds, the owner's fused
// winner, 2026-09-25). L0 is five shapes, top to bottom: tickets waiting on you, the live strip, a chart
// over a table of rounds, the arm league, the next round's ticket. Figures, marks, names and short
// labels only — every caveat is an ⓘ tip or an inner page. The inner layer (round → lane → log, each
// card's evidence, each arm) is a designed document over the whole screen, addressed by the URL hash.
//
// This file folds the data ONCE and hands every section the same context; the live pulse is the
// Theater's own transport, so the desk and the wall can never disagree about liveness.

import { useMemo, useRef } from "react";
import { feedStale, useTheaterPulse } from "../theater/useTheaterPulse";
import { ArmLeague } from "./ArmLeague";
import type { DeskCtx, DeskHrefs } from "./deskCtx";
import { DeskHeader, type FeedWord } from "./DeskHeader";
import { DeskLayer } from "./DeskLayer";
import { DeskPortal } from "./DeskPortal";
import { TipBox, useTipBox } from "./DeskTip";
import type { DeskData } from "./deskTypes";
import { dur } from "./deskFormat";
import { foldArms } from "./armsModel";
import { InFlightSection } from "./InFlightSection";
import { NextRoundSetup } from "./NextRoundSetup";
import { RoundsSection } from "./RoundsSection";
import { foldRounds } from "./roundsModel";
import { searchIndex } from "./searchModel";
import { useDeskRoute } from "./useDeskRoute";
import { deriveWaiting } from "./waitingModel";
import { WaitingSection } from "./WaitingSection";
import r from "./deskRounds.module.css";
import s from "./desk.module.css";

export function Desk({ data, hrefs }: { data: DeskData; hrefs: DeskHrefs }) {
  const slug = data.ledger.slug;
  const feed = useTheaterPulse(`/api/org/loop/pulse?org=${encodeURIComponent(slug)}`);
  const stale = feedStale(feed);
  const [route, go] = useDeskRoute();
  const root = useRef<HTMLDivElement>(null);
  const tip = useTipBox(root);

  const fold = useMemo(() => (data.rounds ? foldRounds(data.rounds, data.lanes) : null), [data.rounds, data.lanes]);
  const arms = useMemo(() => (fold && data.lanes ? foldArms(fold.rounds) : []), [fold, data.lanes]);
  // The live plan count only counts while the feed is fresh — a stale pulse is not evidence of now.
  const livePlans = feed.pulse && !stale ? feed.pulse.needsYou.plans : null;
  const waiting = useMemo(() => deriveWaiting(data, livePlans, (id) => fold?.byId.get(id)?.seq ?? null), [data, livePlans, fold]);
  const index = useMemo(() => (fold ? searchIndex(fold.rounds, arms) : []), [fold, arms]);

  const ctx: DeskCtx = { slug, data, fold, arms, waiting, hrefs, go };
  const heard = feed.receivedAt != null ? dur(feed.now - feed.receivedAt) : null;
  const word: FeedWord = !feed.loaded
    ? stale
      ? { tone: "stale", text: "no answer" }
      : { tone: "off", text: "listening" }
    : stale
      ? { tone: "stale", text: `last heard ${heard ?? "?"} ago` }
      : { tone: "live", text: "live feed" };

  return (
    <div className={s.desk} ref={root} data-testid="desk">
      <div className={s.wrap}>
        <DeskHeader ctx={ctx} feed={word} index={index} />
        <div className={s.main}>
          <WaitingSection ctx={ctx} />
          <InFlightSection ctx={ctx} feed={feed} stale={stale} />
          <RoundsSection ctx={ctx} />
          <div className={s.pair}>
            <ArmLeague ctx={ctx} />
            <NextRoundSetup ctx={ctx} />
          </div>
        </div>
        <footer className={r.foot}>
          <span>org {slug}</span>
          {fold ? (
            <span>
              {fold.totals.runs}
              {data.roundsHasMore ? "+" : ""} rounds · {fold.totals.lanes} lanes
            </span>
          ) : null}
          {data.failed.length ? <span className={s.amber}>could not read: {data.failed.join(", ")}</span> : null}
          <span>/ search · Esc back · [ ] prev/next</span>
        </footer>
      </div>
      {route ? (
        <DeskPortal>
          <DeskLayer ctx={ctx} route={route} />
        </DeskPortal>
      ) : null}
      {tip ? (
        <DeskPortal>
          <TipBox tip={tip} />
        </DeskPortal>
      ) : null}
    </div>
  );
}
