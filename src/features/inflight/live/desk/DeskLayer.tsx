"use client";

// The inner layer: which document the address names, and the ONE run-detail read the round, lane and
// log pages share. A read in flight or failed is said in the frame (with a retry), never an empty page.

import type { ReactNode } from "react";
import type { DeskCtx } from "./deskCtx";
import type { DeskRoute } from "./deskRoute";
import { ArmDoc } from "./ArmDoc";
import { LaneDoc } from "./LaneDoc";
import { LayerFrame, type Crumb } from "./LayerFrame";
import { LogDoc } from "./LogDoc";
import { RoundDoc } from "./RoundDoc";
import { WaitDoc } from "./WaitDoc";
import { laneNav, roundNav } from "./layerNav";
import { useRunDetail, type DetailState } from "./useRunDetail";
import s from "./desk.module.css";
import l from "./deskLayers.module.css";

function Pending({ state, what, retry }: { state: DetailState; what: string; retry: () => void }) {
  return (
    <div className={l.doc}>
      {state.status === "failed" ? (
        <div className={`${l.callout} ${l.red}`} data-testid="desk-layer-failed">
          <b>Could not read {what}</b>
          <span>
            {state.error}{" "}
            <button type="button" className={`${s.btn} ${s.sm}`} onClick={retry}>
              Retry
            </button>
          </span>
        </div>
      ) : (
        <div className={l.empty}>Reading {what}…</div>
      )}
    </div>
  );
}

export function DeskLayer({ ctx, route }: { ctx: DeskCtx; route: DeskRoute }) {
  const runId = route.kind === "round" || route.kind === "lane" || route.kind === "log" ? route.runId : null;
  const { state, retry } = useRunDetail(ctx.slug, runId);
  const { go, fold } = ctx;

  if (route.kind === "wait") return <WaitDoc ctx={ctx} k={route.key} />;
  if (route.kind === "arm") return <ArmDoc ctx={ctx} armKey={route.key} />;

  const round = fold?.byId.get(route.runId) ?? null;
  const label = round ? `Round ${round.label}` : "Round";
  const detail = state?.status === "ready" ? state.detail : null;

  if (!detail) {
    const nav = route.kind === "round" ? roundNav(fold, route.runId) : laneNav(fold, route.laneId, route.kind);
    const crumbs: Crumb[] = [{ label: "Desk", to: null }, { label }];
    const body: ReactNode = <Pending state={state ?? { status: "loading" }} what={label.toLowerCase()} retry={retry} />;
    return (
      <LayerFrame crumbs={crumbs} prev={nav.prev} next={nav.next} go={go} docKey={`${route.kind}:${route.runId}`}>
        {body}
      </LayerFrame>
    );
  }
  if (route.kind === "round") return <RoundDoc ctx={ctx} round={round} detail={detail} />;
  if (route.kind === "lane") return <LaneDoc ctx={ctx} round={round} detail={detail} laneId={route.laneId} />;
  return <LogDoc ctx={ctx} round={round} detail={detail} laneId={route.laneId} />;
}
