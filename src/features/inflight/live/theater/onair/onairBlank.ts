// What an EMPTY monitor says, and the CALL corner's detail line — pure words from the pulse.
//
// A slot with no lane is never blank without a reason: the runner is paused (HELD, until when),
// idle (every repo resting, the next wake), absent (NO RUNNER), stopped, or simply has fewer lanes in
// flight than the wall has monitors (STANDBY, and how many the run flies).

import type { LoopPulse } from "@/lib/local/runner-types";
import { fmtClock, fmtDuration, toMs } from "../theaterFormat";
import { PAUSE_WORDS, plural } from "./onairFormat";

export interface BlankCard {
  tone: "amber" | "grey";
  big: string;
  src: string;
  lines: [string, string];
  foot: string;
}

const until = (iso: string | null, clock: number, open: string): string => {
  const t = toMs(iso);
  return t != null ? `until ${fmtClock(iso)} · resumes in ${fmtDuration(t - clock)}` : open;
};

export function blankCard(p: LoopPulse | null, clock: number, slot: string): BlankCard {
  const r = p?.runner ?? null;
  if (r?.phase === "paused") {
    const why = PAUSE_WORDS[r.pausedReason ?? ""] ?? "a breaker fired";
    return {
      tone: "amber",
      big: "HELD",
      src: `${slot} · no lane dispatched`,
      lines: [`Runner paused · ${why}`, until(r.pausedUntil, clock, "until a person resumes it")],
      foot: "No lane dispatches while paused",
    };
  }
  if (r?.phase === "idle") {
    const wakes = r.repos.map((x) => toMs(x.pausedUntil)).filter((t): t is number => t != null && t > clock);
    const next = wakes.length ? Math.min(...wakes) : null;
    const wake = next != null ? `next repo wakes at ${fmtClock(new Date(next).toISOString())} · in ${fmtDuration(next - clock)}` : "";
    return { tone: "grey", big: "IDLE", src: `${slot} · no lane`, lines: ["Every repo is resting", wake], foot: "Repos back off after dry runs" };
  }
  if (!r) return { tone: "grey", big: "NO RUNNER", src: slot, lines: ["The standing runner is not started", ""], foot: "" };
  if (r.phase === "stopped" || r.phase === "error") {
    const word = r.phase === "error" ? "Stopped on an error" : "The runner is stopped";
    return { tone: "grey", big: "STOPPED", src: slot, lines: [word, plural(r.runsDone, "run done", "runs done")], foot: "" };
  }
  const flies = p?.run ? `run #${p.run.seq ?? "?"} flies ${plural(p.lanes.length, "lane")}` : "no run in flight";
  return { tone: "grey", big: "STANDBY", src: `${slot} · slot free`, lines: ["No lane in this slot", flies], foot: "" };
}

/** The newest pending plan per repo — only while the pulse says plans wait. */
export function planRepos(p: LoopPulse | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!p || p.needsYou.plans <= 0) return out;
  for (const e of p.latest) if (e.kind === "plan-pending" && !out.has(e.repo)) out.set(e.repo, e.headline);
  return out;
}

/**
 * The CALL corner's supporting line: WHAT waits (the newest pending plan, or the pause and when it
 * lifts) and where it is decided. The headline itself is `headerModel().needs` — the classic header's
 * answer — so the two walls cannot disagree about whether, or how much, needs a person.
 */
export function needsDetail(p: LoopPulse | null, clock: number, linked: boolean): string {
  const where = linked ? "decide it in the ledger" : "decided in the ledger";
  const plan = planRepos(p).values().next().value;
  if (plan) return `${plan} · ${where}`;
  const r = p?.runner;
  if (r?.phase === "paused") return until(r.pausedUntil, clock, "until a person resumes it");
  if (p && p.needsYou.pausedRepos > 0) return `${plural(p.needsYou.pausedRepos, "repo")} paused · ${where}`;
  return where;
}
