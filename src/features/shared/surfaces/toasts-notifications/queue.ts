// The transient tier as a queue with policy (queue-discipline). Pure functions over `QueueState`:
// admission mints nothing (identity arrives from the desk) and keys everything on it; a semantic key
// drives coalescing and the post-dismissal cooldown; MAX_VISIBLE bounds the screen; severity preempts
// the lowest visible slot so a fresh critical never waits behind stale successes; overflow degrades
// in order — coalesce harder, summarize the tail, shed lowest-first — and every shed is counted. Every
// dwell is a number on the entry: dismissal removes the entry, and with it the only timer it had.

import type { DeskEvent } from "./fixtures";
import { KIND_META, semanticKey } from "./fixtures";
import { SEVERITY_RANK, SEVERITY_TABLE, dwellFor, type Severity } from "./severity";

export const MAX_VISIBLE = 3;
export const WAIT_TOLERANCE = 2;
export const SUMMARY_KEY = "summary:*";

export interface Toast {
  id: string;
  key: string;
  kind: DeskEvent["kind"] | "summary";
  subject: string;
  severity: Severity;
  actionRequired: boolean;
  title: string;
  verb: string | null;
  count: number;
  dwellMs: number | null;
  remainingMs: number | null;
  attended: boolean;
}

export interface QueueStats {
  coalesced: number;
  suppressed: number;
  shed: number;
  summarized: number;
}

export interface QueueState {
  toasts: Toast[];
  cooldownUntil: Record<string, number>;
  stats: QueueStats;
}

export const emptyQueue = (): QueueState => ({ toasts: [], cooldownUntil: {}, stats: { coalesced: 0, suppressed: 0, shed: 0, summarized: 0 } });

export type Outcome = "shown" | "queued" | "coalesced" | "suppressed";

export const visible = (q: QueueState) => q.toasts.slice(0, MAX_VISIBLE);
export const waiting = (q: QueueState) => q.toasts.slice(MAX_VISIBLE);

/** Admit one event under identity `id` at scene time `now`. Returns the outcome so the desk can announce it. */
export function admit(q: QueueState, ev: DeskEvent, id: string, now: number, dwellOverride?: number): { state: QueueState; outcome: Outcome; id: string } {
  const key = semanticKey(ev);
  const live = q.toasts.find((t) => t.key === key);
  if (live) {
    // Same semantic key while a toast for it is live → one toast with a count; dwell refreshed.
    const toasts = q.toasts.map((t) => (t.key === key ? { ...t, count: t.count + 1, remainingMs: t.dwellMs } : t));
    return { state: { ...q, toasts, stats: { ...q.stats, coalesced: q.stats.coalesced + 1 } }, outcome: "coalesced", id: live.id };
  }
  const until = q.cooldownUntil[key];
  if (until !== undefined && now < until) {
    // Shortly after dismissal the repeat only bumps the record — counted, never silent.
    return { state: { ...q, stats: { ...q.stats, suppressed: q.stats.suppressed + 1 } }, outcome: "suppressed", id };
  }
  const dwellMs = dwellOverride ?? dwellFor(ev.severity, ev.actionRequired, ev.title);
  const toast: Toast = { id, key, kind: ev.kind, subject: ev.subject, severity: ev.severity, actionRequired: ev.actionRequired, title: ev.title, verb: ev.verb, count: 1, dwellMs, remainingMs: dwellMs, attended: false };
  const state = applyOverflow({ ...q, toasts: place(q.toasts, toast) });
  const outcome: Outcome = state.toasts.slice(0, MAX_VISIBLE).some((t) => t.id === id) ? "shown" : "queued";
  return { state, outcome, id };
}

/** Stable order, newest visible: a full window yields its lowest-ranked slot to a higher severity. */
function place(toasts: Toast[], toast: Toast): Toast[] {
  if (toasts.length < MAX_VISIBLE) return [...toasts, toast];
  const shown = toasts.slice(0, MAX_VISIBLE);
  const lowest = shown.reduce((a, b) => (SEVERITY_RANK[b.severity] < SEVERITY_RANK[a.severity] ? b : a));
  if (SEVERITY_RANK[toast.severity] > SEVERITY_RANK[lowest.severity]) {
    const rest = toasts.filter((t) => t.id !== lowest.id);
    return [...rest.slice(0, MAX_VISIBLE - 1), toast, lowest, ...rest.slice(MAX_VISIBLE - 1)];
  }
  return [...toasts, toast];
}

/** Overflow, in order: coalesce same-kind waiters, then summarize the tail past the tolerance. */
function applyOverflow(q: QueueState): QueueState {
  let shown = q.toasts.slice(0, MAX_VISIBLE);
  let rest = q.toasts.slice(MAX_VISIBLE);
  let { coalesced, shed, summarized } = q.stats;
  if (rest.length > WAIT_TOLERANCE) {
    const byKind = new Map<string, Toast[]>();
    for (const t of rest) if (t.kind !== "summary") byKind.set(t.kind, [...(byKind.get(t.kind) ?? []), t]);
    for (const [kind, group] of byKind) {
      const head = group[0];
      if (group.length < 2 || !head) continue;
      const count = group.reduce((n, t) => n + t.count, 0);
      const merged: Toast = { ...head, key: `${kind}:*`, subject: "*", title: `${count} × ${KIND_META[head.kind as DeskEvent["kind"]].label}`, count, verb: "Open center" };
      coalesced += group.length - 1;
      rest = [merged, ...rest.filter((t) => !group.includes(t))];
    }
  }
  if (rest.length > WAIT_TOLERANCE) {
    const tail = rest.slice(WAIT_TOLERANCE).filter((t) => t.kind !== "summary");
    const prior = q.toasts.find((t) => t.kind === "summary");
    const n = (prior?.count ?? 0) + tail.reduce((s, t) => s + t.count, 0);
    const summary: Toast = { id: prior?.id ?? "summary", key: SUMMARY_KEY, kind: "summary", subject: "*", severity: "info", actionRequired: false, title: `${n} more notifications`, verb: "Open center", count: n, dwellMs: null, remainingMs: null, attended: false };
    shed += tail.length;
    summarized += 1;
    shown = shown.filter((t) => t.kind !== "summary");
    rest = [...rest.slice(0, WAIT_TOLERANCE).filter((t) => t.kind !== "summary"), summary];
  }
  return { ...q, toasts: [...shown, ...rest], stats: { ...q.stats, coalesced, shed, summarized } };
}

/** Advance every VISIBLE, unattended dwell by `dt`. Waiting toasts do not age. Returns the expired ones. */
export function tick(q: QueueState, dt: number, now: number): { state: QueueState; expired: Toast[] } {
  const expired: Toast[] = [];
  const toasts: Toast[] = [];
  q.toasts.forEach((t, i) => {
    if (i >= MAX_VISIBLE || t.attended || t.remainingMs === null) return toasts.push(t);
    const remainingMs = t.remainingMs - dt;
    if (remainingMs <= 0) expired.push(t);
    else toasts.push({ ...t, remainingMs });
  });
  let state: QueueState = { ...q, toasts };
  for (const t of expired) state = stamp(state, t.key, t.severity, now);
  return { state: applyOverflow(state), expired };
}

/** Removing the entry removes its timer: there is nothing left to fire into a reused slot. */
export function dismiss(q: QueueState, id: string, now: number): QueueState {
  const t = q.toasts.find((x) => x.id === id);
  if (!t) return q;
  return applyOverflow(stamp({ ...q, toasts: q.toasts.filter((x) => x.id !== id) }, t.key, t.severity, now));
}

/** A resolved fact retracts its live toast without a cooldown (the news is over, not dismissed). */
export function retract(q: QueueState, key: string): QueueState {
  return applyOverflow({ ...q, toasts: q.toasts.filter((t) => t.key !== key) });
}

/** Attention pauses the clock; leaving grants a fresh reading allowance, never the stale remainder. */
export function attend(q: QueueState, id: string, on: boolean): QueueState {
  return { ...q, toasts: q.toasts.map((t) => (t.id === id ? { ...t, attended: on, remainingMs: on ? t.remainingMs : t.dwellMs } : t)) };
}

function stamp(q: QueueState, key: string, severity: Severity, now: number): QueueState {
  const ms = SEVERITY_TABLE[severity].cooldownMs;
  if (ms === 0 || key === SUMMARY_KEY) return q;
  return { ...q, cooldownUntil: { ...q.cooldownUntil, [key]: now + ms } };
}
