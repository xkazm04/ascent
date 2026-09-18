// THE FOLD — one pulse into the heat map's accumulator. Pure: (acc, pulse, now) → acc, never mutating
// its input, so the hero can fold during render and a test can fold a script of pulses.
//
// What it trusts, in order:
//   1. a NEW tail event (not in the previous pulse's tail for this session) names a path, a kind and
//      WHEN — the only exact touch time the pulse carries;
//   2. a path in `filesRead`/`filesEdited` the map has not seen: on the first pulse of a session it
//      was touched at an unknown moment before (time null — explored, not glowing); on a later pulse
//      it was touched since the previous one, so the pulse's own `at` is honest to within one read.
// Landings (`landed`/`verified-close` in `pulse.latest`) stamp the modules the landing session edited.
// Events already in the FIRST pulse are history: a landing inside the session on screen still earns
// its resting badge, but never a celebration.

import type { LanePulse, LaneActivity, LoopPulse, PulseEvent } from "@/lib/local/runner-types";
import { eventKey } from "../../theaterPulseParse";
import { toMs } from "../../theaterFormat";
import { cleanPath, moduleOf } from "./heatModules";
import { FILES_MAX, SEEN_MAX, type HeatAcc, type HeatSession, type HeatStamp, type RepoHeat, type TouchKind } from "./heatTypes";

const tailKey = (e: LaneActivity) => `${e.at}|${e.kind}|${e.path ?? ""}|${e.tool ?? ""}|${e.note ?? ""}`;
const TOUCH: Partial<Record<LaneActivity["kind"], TouchKind>> = { read: "read", search: "read", edit: "edit", write: "edit" };
const maxOf = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));

function cloneRepo(r: RepoHeat): RepoHeat {
  const s = (x: HeatSession | null) => (x ? { ...x, editedModules: [...x.editedModules] } : null);
  return {
    ...r,
    files: r.files.map((f) => ({ ...f })),
    session: s(r.session),
    prev: s(r.prev),
    stamps: r.stamps.map((x) => ({ ...x, kinds: [...x.kinds] })),
    tailKeys: [...r.tailKeys],
  };
}

function newRepo(repo: string, now: number): RepoHeat {
  return { repo, since: now, files: [], session: null, prev: null, stamps: [], tailKeys: [], lastTouchAt: null, landings: 0 };
}

/** Record one touch. `at` null = the evidence carried no time (explored, not glowing). */
function touch(r: RepoHeat, rawPath: string, kind: TouchKind, at: number | null, now: number): void {
  const path = cleanPath(rawPath);
  if (!path) return;
  let f = r.files.find((x) => x.path === path);
  if (!f) {
    f = { path, module: moduleOf(path), seenAt: now, readAt: null, editAt: null, read: false, edited: false };
    r.files.push(f);
  }
  if (kind === "edit") {
    f.edited = true;
    f.editAt = maxOf(f.editAt, at);
    if (r.session && !r.session.editedModules.includes(f.module)) r.session.editedModules.push(f.module);
  } else {
    f.read = true;
    f.readAt = maxOf(f.readAt, at);
  }
  r.lastTouchAt = maxOf(r.lastTouchAt, at);
  if (r.session) r.session.touches += 1;
}

function foldLane(r: RepoHeat, lane: LanePulse, pulseAt: number, now: number): void {
  const key = `${lane.laneId}|${lane.startedAt ?? ""}`;
  const fresh = r.session?.key !== key;
  if (fresh) {
    r.prev = r.session;
    r.session = { key, startMs: toMs(lane.startedAt), editedModules: [], touches: 0 };
    r.tailKeys = [];
  }
  const known = new Set(r.tailKeys);
  for (const e of lane.tail) {
    const kind = TOUCH[e.kind];
    if (kind && e.path && !known.has(tailKey(e))) touch(r, e.path, kind, toMs(e.at) ?? pulseAt, now);
  }
  r.tailKeys = lane.tail.map(tailKey);
  // Window paths the tail did not explain: timed by the pulse, unless this is the session's first sight.
  const at = fresh ? null : pulseAt;
  for (const p of lane.filesEdited) {
    const f = r.files.find((x) => x.path === cleanPath(p));
    if (!f?.edited) touch(r, p, "edit", at, now);
    else if (r.session && !r.session.editedModules.includes(f.module)) r.session.editedModules.push(f.module);
  }
  for (const p of lane.filesRead) if (!r.files.some((x) => x.path === cleanPath(p))) touch(r, p, "read", at, now);
}

/** The session a landing at `atMs` belongs to: the newest one that started before it and edited. */
function landingSession(r: RepoHeat, atMs: number, primed: boolean): HeatSession | null {
  const fits = (s: HeatSession | null) => s != null && s.editedModules.length > 0 && (s.startMs == null || s.startMs <= atMs);
  if (fits(r.session)) return r.session;
  return primed && fits(r.prev) ? r.prev : null;
}

function stamp(r: RepoHeat, e: PulseEvent, primed: boolean, now: number): void {
  const atMs = toMs(e.at) ?? now;
  const s = landingSession(r, atMs, primed);
  if (!s) return;
  const kind: HeatStamp["kinds"][number] = e.kind === "landed" ? "landed" : "verified";
  if (!r.stamps.some((x) => x.sessionKey === s.key)) r.landings += 1;
  for (const mod of s.editedModules) {
    const i = r.stamps.findIndex((x) => x.module === mod);
    const old = i >= 0 ? r.stamps[i]! : null;
    if (old && old.sessionKey === s.key) {
      if (!old.kinds.includes(kind)) old.kinds.push(kind);
      continue;
    }
    const next: HeatStamp = { module: mod, at: now, kinds: [kind], celebrate: primed, sessionKey: s.key, count: (old?.count ?? 0) + 1 };
    if (old) r.stamps[i] = next;
    else r.stamps.push(next);
  }
}

/** Past `FILES_MAX`, drop the coldest files that were only ever read. */
function bound(r: RepoHeat): void {
  if (r.files.length <= FILES_MAX) return;
  const drop = r.files
    .filter((f) => !f.edited)
    .sort((a, b) => (a.readAt ?? -1) - (b.readAt ?? -1) || a.seenAt - b.seenAt)
    .slice(0, r.files.length - FILES_MAX)
    .map((f) => f.path);
  r.files = r.files.filter((f) => !drop.includes(f.path));
}

/** One lane per repo: a finished lane beside its successor would otherwise flip the session every
 *  pulse. The working lane wins, then the newest start. */
export function laneOfRepo(lanes: readonly LanePulse[]): LanePulse[] {
  const best = new Map<string, LanePulse>();
  const rank = (l: LanePulse) => [l.phase === "done" ? 0 : 1, toMs(l.startedAt) ?? 0] as const;
  for (const l of lanes) {
    const b = best.get(l.repo);
    const [lw, ls] = rank(l);
    if (!b || lw > rank(b)[0] || (lw === rank(b)[0] && ls > rank(b)[1])) best.set(l.repo, l);
  }
  return [...best.values()];
}

export function foldPulse(acc: HeatAcc, pulse: LoopPulse, now: number): HeatAcc {
  const pulseAt = toMs(pulse.at) ?? now;
  const repos: Record<string, RepoHeat> = { ...acc.repos };
  for (const lane of laneOfRepo(pulse.lanes)) {
    const r = repos[lane.repo] ? cloneRepo(repos[lane.repo]!) : newRepo(lane.repo, now);
    foldLane(r, lane, pulseAt, now);
    bound(r);
    repos[lane.repo] = r;
  }
  const seen = new Set(acc.seen);
  const fresh: PulseEvent[] = [];
  for (const e of pulse.latest) {
    const k = eventKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(e);
  }
  // Oldest first, so `landed` then `verified-close` for one session make one stamp with both kinds.
  for (const e of fresh.reverse()) {
    if ((e.kind !== "landed" && e.kind !== "verified-close") || !repos[e.repo]) continue;
    const r = cloneRepo(repos[e.repo]!);
    stamp(r, e, acc.primed, now);
    repos[e.repo] = r;
  }
  return { primed: true, repos, seen: [...seen].slice(-SEEN_MAX) };
}
