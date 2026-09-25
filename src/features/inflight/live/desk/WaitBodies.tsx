"use client";

// The Waiting pages' bodies, one per card: a heading, a figure strip, then the evidence. Nothing is
// decided here — the pages that need a person's verdict hand over to the Ledger. No hooks.

import type { ReactNode } from "react";
import type { DeskCtx } from "./deskCtx";
import { Empty, Text, VChip, type Cell } from "./DocParts";
import { date, repoShort } from "./deskFormat";
import { byRepo, type WaitKey } from "./waitingModel";
import { PlanEvidence } from "./WaitPlans";
import { allLanes, laneName } from "./layerNav";
import l from "./deskLayers.module.css";
import s from "./desk.module.css";

export interface WaitBody {
  title: string;
  sub: string;
  cells: Cell[];
  body: ReactNode;
  /** Where the decision is made, when this page leads to one. */
  decide: string | null;
}

const PAUSE: Record<string, string> = { "repo-failures": "failure streak", "branch-conflict": "branch conflict", "dependency-install": "dependency install" };

export function waitBody(ctx: DeskCtx, k: WaitKey): WaitBody {
  const w = ctx.waiting;
  const seqOf = (runId: string) => ctx.fold?.byId.get(runId)?.label ?? "?";
  if (k === "plans") {
    const plans = w.plans;
    if (plans == null) return { title: "Could not read the plans", sub: "The plan inbox read failed; reload to retry.", cells: [], body: null, decide: null };
    return {
      title: plans.length ? `${plans.length} ${plans.length === 1 ? "plan waits" : "plans wait"} for a verdict` : "No plan waits",
      sub: plans.length ? "An architecture move waits for a person." : "The inbox is clear.",
      cells: [[plans.length, "plans pending", plans.length ? s.amber : s.faint], [byRepo(plans.map((p) => p.repo)) || "-", "by repo"], [plans.length ? date(plans[plans.length - 1]!.createdAt) : "-", "oldest filed"]],
      body: plans.map((p) => (
        <div key={p.id} className={l.dsec}>
          <h3>{repoShort(p.repo)}</h3>
          <PlanEvidence plan={p} />
        </div>
      )),
      decide: plans.length ? "Decide on the Ledger" : null,
    };
  }
  if (k === "paused")
    return {
      title: `${w.paused.length} ${w.paused.length === 1 ? "repo waits" : "repos wait"} for a resume`,
      sub: "A breaker with no timer paused it. Only a person lifts it.",
      cells: [[w.paused.length, "repos paused", s.amber]],
      body: (
        <div className={l.panel}>
          {w.paused.map((r) => (
            <div key={r.repo} className={l.item}>
              <div className={l.h}>
                <span>{repoShort(r.repo)}</span>
                <span className={`${l.vchip} ${l.baseline}`}>{PAUSE[r.paused ?? ""] ?? r.paused}</span>
                <span className={`${s.faint} ${s.mono}`} style={{ fontSize: 13, fontWeight: 400 }}>
                  failure streak {r.failureStreak}
                </span>
              </div>
              {r.note ? <Text className={l.b}>{r.note}</Text> : null}
            </div>
          ))}
        </div>
      ),
      decide: "Resume on the Ledger",
    };
  if (k === "merge") {
    const known = w.ahead.filter((a) => a.commits != null);
    const sum = known.reduce((n, a) => n + (a.commits ?? 0), 0);
    return {
      title: known.some((a) => (a.commits ?? 0) > 0) ? `${sum} runner ${sum === 1 ? "commit" : "commits"} to merge` : "Merge state unknown",
      sub: "Verified work sits on the runner branch. Merging it into the base is yours.",
      cells: [[sum, "commits ahead (counted)", s.amber], [w.ahead.length - known.length, "repos git could not count", w.ahead.length - known.length ? s.faint : undefined]],
      body: (
        <div className={l.panel}>
          {w.ahead.map((a) => (
            <div key={a.repo} className={l.item}>
              <div className={l.h}>
                <span>{repoShort(a.repo)}</span>
                <span className={s.mono} style={{ fontWeight: 400 }}>
                  {a.commits == null ? <span className={s.faint}>unknown — git could not say</span> : `${a.commits} ahead`}
                </span>
              </div>
            </div>
          ))}
        </div>
      ),
      decide: "Merge on the Ledger",
    };
  }
  if (k === "rejected") {
    const all = new Map(allLanes(ctx.fold).map((x) => [x.lane.id, x]));
    return {
      title: `${w.rejected.length} ${w.rejected.length === 1 ? "change" : "changes"} the guard rejected`,
      sub: "They broke the repo's own check. Never delivered.",
      cells: [[w.rejected.length, "rejected lanes", s.red], [[...new Set(w.rejected.map((x) => seqOf(x.runId)))].join(" "), "rounds"]],
      body: (
        <div className={l.panel}>
          {w.rejected.map((x) => (
            <div key={x.id} className={l.item}>
              <button type="button" className={l.h} onClick={() => ctx.go({ kind: "lane", runId: x.runId, laneId: x.id })}>
                {all.get(x.id)?.label ?? "?"} · {laneName(x.repo, x.cycle)} <VChip verdict={x.verdict} />
                <span className={`${s.faint} ${s.mono}`} style={{ fontSize: 13, fontWeight: 400 }}>
                  {x.closes} closes · {x.commits} commits
                </span>
              </button>
            </div>
          ))}
        </div>
      ),
      decide: null,
    };
  }
  if (k === "lessons") return lessonsBody(ctx);
  return staleBody(ctx);
}

function lessonsBody(ctx: DeskCtx): WaitBody {
  const lessons = ctx.waiting.lessons;
  if (lessons == null) return { title: "Could not read the lessons", sub: "The lesson read failed; reload to retry.", cells: [], body: null, decide: null };
  const groups = new Map<string, typeof lessons>();
  for (const x of lessons) groups.set(x.namespace ?? "unscoped", [...(groups.get(x.namespace ?? "unscoped") ?? []), x]);
  const lanes = new Map(allLanes(ctx.fold).map((x) => [x.lane.id, x]));
  return {
    title: `${lessons.length} ${lessons.length === 1 ? "lesson waits" : "lessons wait"} for review`,
    sub: "Proposed by the lanes. Keep one into memory, or let it go.",
    cells: [[lessons.length, "pending lessons", s.blue], ...[...groups.entries()].map(([k, v]): Cell => [v.length, repoShort(k)])],
    body: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => (
      <div key={k} className={l.dsec}>
        <h3>
          {repoShort(k)} <span className={l.count}>{v.length}</span>
        </h3>
        <div className={`${l.panel} ${l.lgrid}`}>
          {v.map((x) => {
            const lane = x.laneId ? lanes.get(x.laneId) : undefined;
            return (
              <div key={x.id} className={l.item}>
                <Text>{x.content}</Text>
                <div className={l.m}>
                  {lane ? (
                    <button type="button" className={l.fileChip} onClick={() => ctx.go({ kind: "lane", runId: lane.lane.runId, laneId: lane.lane.id })}>
                      {lane.label} {laneName(lane.lane.repo, lane.lane.cycle)}
                    </button>
                  ) : null}
                  <span className={l.fileChip}>{x.kind || "lesson"}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )),
    decide: null,
  };
}

function staleBody(ctx: DeskCtx): WaitBody {
  const stale = ctx.waiting.stale;
  return {
    title: "A plan still reads “executing”",
    sub: "Its run ended. Nothing will move it now but a person.",
    cells: [[stale.length, "stale plans", s.amber], [stale.map((x) => (x.seq != null ? `#${x.seq}` : "?")).join(" "), "rounds"]],
    body: stale.length ? stale.map(({ plan, lane }) => (
      <div key={plan.id} className={l.dsec}>
        <h3>
          {repoShort(plan.repo)}
          {lane ? (
            <span className={l.right}>
              <button type="button" className={l.fileChip} onClick={() => ctx.go({ kind: "lane", runId: lane.runId, laneId: lane.id })}>
                its lane {lane.errored ? "· failed" : ""} →
              </button>
            </span>
          ) : null}
        </h3>
        <PlanEvidence plan={plan} />
      </div>
    )) : <Empty>No stale plan.</Empty>,
    decide: "Close it on the Ledger",
  };
}
