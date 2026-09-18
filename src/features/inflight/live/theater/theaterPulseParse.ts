// Reading the pulse DEFENSIVELY, and noticing what is new in it — pure, shared by the live hook and
// the demo clock so both feed the page the same shapes.
//
// The route answers `LoopPulse`, or `{ pulse: null }` / `null` when there is nothing to report, and a
// server a release behind may omit a field this page reads. A passive screen nobody is watching must
// never crash on that, so every array defaults to empty and every sub-object to its zero. What does
// NOT parse (an HTML error page, a string) is a FAILED read — distinct from a valid "nothing running",
// because the page says "Reconnecting…" for one and "No runner" for the other.

import type { LanePulse, LoopPulse, PulseEvent, RunnerPulse } from "@/lib/local/runner-types";

export type ParsedPulse = { ok: true; pulse: LoopPulse | null } | { ok: false };

const EVENT_KINDS: readonly PulseEvent["kind"][] = [
  "landed",
  "verified-close",
  "plan-pending",
  "paused",
  "direction-done",
  "rejected",
  "failed",
];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");

/** A route body → the pulse, "nothing to report", or a failed read. */
export function parsePulseResponse(body: unknown): ParsedPulse {
  if (body == null) return { ok: true, pulse: null };
  if (!isObj(body)) return { ok: false };
  const inner = "lanes" in body || "org" in body ? body : "pulse" in body ? body.pulse : undefined;
  if (inner == null) return "pulse" in body ? { ok: true, pulse: null } : { ok: false };
  const pulse = isObj(inner) ? toPulse(inner) : null;
  return pulse ? { ok: true, pulse } : { ok: false };
}

function toPulse(o: Obj): LoopPulse | null {
  const org = str(o.org);
  const at = str(o.at);
  if (!org || !at) return null;
  const run = isObj(o.run) && str(o.run.id) ? o.run : null;
  const needs = isObj(o.needsYou) ? o.needsYou : {};
  const today = isObj(o.today) ? o.today : {};
  return {
    org,
    at,
    runner: isObj(o.runner) ? toRunner(o.runner) : null,
    run: run
      ? {
          id: str(run.id) ?? "",
          seq: num(run.seq),
          phase: str(run.phase) ?? "running",
          cycle: num(run.cycle) ?? 0,
          maxCycles: num(run.maxCycles) ?? 0,
          startedAt: str(run.startedAt) ?? at,
        }
      : null,
    lanes: arr(o.lanes).filter(isObj).map(toLane).filter((l): l is LanePulse => l !== null),
    waiting: strs(o.waiting),
    needsYou: {
      plans: num(needs.plans) ?? 0,
      pausedRepos: num(needs.pausedRepos) ?? 0,
      runnerPaused: needs.runnerPaused === true,
    },
    today: {
      verifiedCloses: num(today.verifiedCloses) ?? 0,
      landed: num(today.landed) ?? 0,
      liftPoints: num(today.liftPoints),
      spendMicros: num(today.spendMicros) ?? 0,
    },
    latest: arr(o.latest).filter(isObj).map(toEvent).filter((e): e is PulseEvent => e !== null),
  };
}

function toRunner(r: Obj): RunnerPulse | null {
  const phase = str(r.phase);
  if (!phase) return null;
  return {
    driveId: str(r.driveId) ?? "",
    phase: phase as RunnerPulse["phase"],
    pausedReason: (str(r.pausedReason) as RunnerPulse["pausedReason"]) ?? null,
    pausedUntil: str(r.pausedUntil),
    startedAt: str(r.startedAt) ?? "",
    lastBeatAt: str(r.lastBeatAt),
    runsDone: num(r.runsDone) ?? 0,
    spendTodayMicros: num(r.spendTodayMicros) ?? 0,
    spendCeilingMicros: num(r.spendCeilingMicros),
    repos: arr(r.repos).filter(isObj) as unknown as RunnerPulse["repos"],
  };
}

function toLane(l: Obj): LanePulse | null {
  const laneId = str(l.laneId);
  const repo = str(l.repo);
  if (!laneId || !repo) return null;
  const diff = isObj(l.diffStat) ? l.diffStat : null;
  const step = isObj(l.planStep) ? l.planStep : null;
  return {
    laneId,
    repo,
    cycle: num(l.cycle) ?? 0,
    phase: (str(l.phase) ?? "queued") as LanePulse["phase"],
    phaseSince: str(l.phaseSince),
    heartbeatAt: str(l.heartbeatAt),
    startedAt: str(l.startedAt),
    deadlineAt: str(l.deadlineAt),
    planStep: step && num(step.index) != null && num(step.total) != null ? { index: step.index as number, total: step.total as number } : null,
    filesRead: strs(l.filesRead),
    filesEdited: strs(l.filesEdited),
    diffStat: diff ? { files: num(diff.files) ?? 0, plus: num(diff.plus) ?? 0, minus: num(diff.minus) ?? 0 } : null,
    turns: num(l.turns),
    costMicros: num(l.costMicros),
    tail: arr(l.tail).filter(isObj) as unknown as LanePulse["tail"],
  };
}

function toEvent(e: Obj): PulseEvent | null {
  const at = str(e.at);
  const repo = str(e.repo);
  const kind = str(e.kind) as PulseEvent["kind"] | null;
  const headline = str(e.headline);
  if (!at || !repo || !kind || !headline || !EVENT_KINDS.includes(kind)) return null;
  return { at, repo, kind, headline };
}

/** An event's identity. The wire carries no id, and these four fields are what makes one event itself. */
export const eventKey = (e: PulseEvent): string => `${e.at}|${e.repo}|${e.kind}|${e.headline}`;

const SEEN_MAX = 500;

/**
 * What arrived since the last read. On the FIRST read every event is history — it is marked seen and
 * none of it "arrives", which is what keeps a reload from replaying a day of celebrations.
 */
export function diffArrivals(
  seen: ReadonlySet<string>,
  latest: readonly PulseEvent[],
  first: boolean,
): { arrivals: PulseEvent[]; seen: Set<string> } {
  const next = new Set(seen);
  const arrivals: PulseEvent[] = [];
  for (const e of latest) {
    const k = eventKey(e);
    if (next.has(k)) continue;
    next.add(k);
    if (!first) arrivals.push(e);
  }
  // Bounded: `latest` is itself bounded, so only the newest few hundred identities can ever recur.
  while (next.size > SEEN_MAX) next.delete(next.values().next().value as string);
  return { arrivals, seen: next };
}
