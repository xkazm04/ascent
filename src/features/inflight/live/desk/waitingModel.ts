// 01 WAITING ON YOU — what the records say a person has to do, derived and ranked. Pure.
//
// Needs-you outranks everything else: a plan waiting for a verdict, then a repo paused on a breaker only
// a person lifts, then work sitting on the runner branch to merge, then what is worth a read (guard
// rejections, lessons, a plan whose run ended while it still reads "executing"). Every card opens its
// evidence page; nothing is DECIDED on the desk in this beta — decisions stay on the Ledger.
//
// Honesty: a read that failed is a card that says so, never a calm zero. Commits ahead that git could
// not count are UNKNOWN and print as such — never folded into the sum as 0.

import type { DeskData, LoopLessonRow, RoundLane } from "./deskTypes";
import type { LoopPlanRecord, RepoRunnerState } from "../ledger/ledgerTypes";
import { repoShort } from "./deskFormat";

/** How many pending lessons the desk load reads (deskLoad.ts); a full read means "at least this many". */
export const LESSONS_READ = 200;

export type WaitKey = "plans" | "paused" | "merge" | "rejected" | "lessons" | "stale-plan";

export interface WaitCard {
  key: WaitKey;
  cap: string;
  src: "live" | "records";
  /** The big number; a string only for "?" (a read that could not complete). */
  n: number | string;
  title: string;
  sub: string;
  tone: "amber" | "red" | "blue" | null;
  /** Nothing waits here: rendered calm and not a door. */
  calm: boolean;
  /** Amber, pulsing: the live feed says a person is needed right now. */
  live: boolean;
}

export interface AheadRow {
  repo: string;
  commits: number | null;
}

export interface StalePlan {
  plan: LoopPlanRecord;
  lane: RoundLane | null;
  seq: number | null;
}

export interface WaitingModel {
  cards: WaitCard[];
  /** How many cards are doors (something actually waits). */
  open: number;
  plans: LoopPlanRecord[] | null;
  paused: RepoRunnerState[];
  ahead: AheadRow[];
  rejected: RoundLane[];
  lessons: LoopLessonRow[] | null;
  stale: StalePlan[];
}

/** "kp 3 · systedo 4" — a list's repos with their counts, sorted by name. */
export function byRepo(repos: readonly (string | null)[]): string {
  const m = new Map<string, number>();
  for (const r of repos) {
    const k = repoShort(r ?? "unknown");
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.keys()]
    .sort()
    .map((k) => `${k} ${m.get(k)}`)
    .join(" · ");
}

const PAUSE_WORDS: Record<string, string> = {
  "repo-failures": "failure streak",
  "branch-conflict": "branch conflict",
  "dependency-install": "dependency install",
  "dry-backoff": "dry backoff",
};

export function deriveWaiting(data: DeskData, livePlans: number | null, seqOf: (runId: string) => number | null): WaitingModel {
  const { ledger } = data;
  const cards: WaitCard[] = [];
  const card = (c: Omit<WaitCard, "calm" | "live"> & Partial<Pick<WaitCard, "calm" | "live">>) =>
    cards.push({ calm: false, live: false, ...c });

  // Plans waiting for a verdict. The live feed (when fresh) may know of one the page load did not.
  const plans = ledger.pending;
  if (plans == null) card({ key: "plans", cap: "Plan inbox", src: "records", n: "?", title: "Could not read the plans", sub: "reload to retry", tone: "amber" });
  else {
    const n = Math.max(plans.length, livePlans ?? 0);
    if (n === 0) card({ key: "plans", cap: "Plan inbox", src: livePlans != null ? "live" : "records", n: 0, title: "No plan waits", sub: "inbox clear", tone: null, calm: true });
    else
      card({
        key: "plans",
        cap: "Plan waits",
        src: livePlans ? "live" : "records",
        n,
        title: n > 1 ? "Plans waiting for your decision" : "Approve or decline the plan",
        sub: byRepo(plans.map((p) => p.repo)) || "see the Ledger",
        tone: "amber",
        live: !!livePlans,
      });
  }

  // Repos paused on a breaker with no timer: only a person lifts it.
  const runner = ledger.runner;
  const paused = (runner?.repoState ?? []).filter((r) => r.paused != null && r.paused !== "dry-backoff" && r.pausedUntil == null);
  if (paused.length)
    card({
      key: "paused",
      cap: "Repo paused",
      src: "records",
      n: paused.length,
      title: paused.length > 1 ? "Repos wait for a resume" : "A repo waits for a resume",
      sub: paused.map((r) => `${repoShort(r.repo)} ${PAUSE_WORDS[r.paused ?? ""] ?? r.paused}`).join(" · "),
      tone: "amber",
    });

  // Commits on the runner branch not yet on the base. Missing or null = unknown, never 0.
  const ahead: AheadRow[] = Object.entries(ledger.ahead)
    .map(([repo, commits]) => ({ repo, commits: commits ?? null }))
    .sort((a, b) => a.repo.localeCompare(b.repo));
  const toMerge = ahead.filter((a) => (a.commits ?? 0) > 0);
  const unknownAhead = ahead.filter((a) => a.commits == null);
  if (toMerge.length || unknownAhead.length) {
    const sum = toMerge.reduce((s, a) => s + (a.commits ?? 0), 0);
    const parts = [...toMerge.map((a) => `${repoShort(a.repo)} ${a.commits}`), ...unknownAhead.map((a) => `${repoShort(a.repo)} ?`)];
    card({
      key: "merge",
      cap: "Merge is yours",
      src: "records",
      n: toMerge.length ? sum : "?",
      title: toMerge.length ? "Runner commits to merge" : "Merge state unknown",
      sub: parts.join(" · "),
      tone: "amber",
    });
  }

  const rejected = (data.lanes ?? []).filter((l) => l.verdict === "rejected");
  if (rejected.length)
    card({
      key: "rejected",
      cap: "Guard rejected",
      src: "records",
      n: rejected.length,
      title: "Changes that broke the check",
      sub: `rounds ${[...new Set(rejected.map((l) => seqOf(l.runId)))].map((s) => (s == null ? "?" : `#${s}`)).join(" · ")}`,
      tone: "red",
    });

  const lessons = data.pendingLessons;
  if (lessons == null) card({ key: "lessons", cap: "Lessons", src: "records", n: "?", title: "Could not read the lessons", sub: "reload to retry", tone: "blue" });
  else if (lessons.length)
    card({ key: "lessons", cap: "Lessons", src: "records", n: lessons.length >= LESSONS_READ ? `${lessons.length}+` : lessons.length, title: "Lessons waiting for review", sub: byRepo(lessons.map((l) => l.namespace)), tone: "blue" });

  const stale = stalePlans(data, seqOf);
  if (stale.length)
    card({
      key: "stale-plan",
      cap: "Stale plan",
      src: "records",
      n: stale.length,
      title: "Plan still reads “executing”",
      sub: stale.map((s) => `${repoShort(s.plan.repo)} · run ${s.seq != null ? `#${s.seq}` : "?"} ${s.lane?.errored ? "failed" : "ended"}`).join(" · "),
      tone: null,
    });

  return { cards, open: cards.filter((c) => !c.calm).length, plans, paused, ahead, rejected, lessons, stale };
}

/** A plan still `executing` whose run (or lane) has ended — nobody will move it now but a person. */
export function stalePlans(data: DeskData, seqOf: (runId: string) => number | null): StalePlan[] {
  const activeRunId = data.ledger.activeRun?.id ?? null;
  const lanes = new Map((data.lanes ?? []).map((l) => [l.id, l]));
  const runs = new Map((data.rounds ?? []).map((r) => [r.id, r]));
  return (data.ledger.plans ?? []).flatMap((plan) => {
    if (plan.status !== "executing" || !plan.runId || plan.runId === activeRunId) return [];
    const lane = plan.laneId ? (lanes.get(plan.laneId) ?? null) : null;
    const run = runs.get(plan.runId);
    const laneEnded = lane != null && (lane.errored || lane.endedAt != null);
    const runEnded = run != null && run.endedAt != null;
    return laneEnded || runEnded ? [{ plan, lane, seq: seqOf(plan.runId) }] : [];
  });
}
