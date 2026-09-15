// The fleet desk's one store: every out-of-band event flows through `emit`, which writes the ledger
// (admission decided at the source), admits the toast (the queue's policy decides the pixels), decides
// the OS send, and queues ONE announcement — four projections of one identity, minted here once.
// Acting in any tier resolves the others through the same handlers. Pure reducer; the clock is a
// `tick` action the hook dispatches, so scene time is state and the tests can step it.

import { type AnnouncerState, drainNow, drainTick, emptyAnnouncer, enqueue } from "./announcer";
import { type OsState, clickThrough, initialOs, send, withdraw } from "./escalation";
import { EVENTS, KIND_META, UNDO_WINDOW_MS, semanticKey, type DeskEvent, type EventKind, type Surface } from "./fixtures";
import { type Entry, markAllRead, markRead, reap, record, resolve, resolveByKey } from "./ledger";
import { SUMMARY_KEY, type QueueState, type Toast, admit, attend, dismiss, emptyQueue, retract, tick } from "./queue";
import { politenessFor } from "./severity";

export interface RepoRow {
  name: string;
  status: "watched" | "pending-removal" | "removed";
}
export type RescanState = "idle" | "failed" | "recovered";

export interface DeskState {
  now: number;
  seq: number;
  queue: QueueState;
  ledger: Entry[];
  os: OsState;
  announcer: AnnouncerState;
  fleet: RepoRow[];
  rescans: Record<string, RescanState>;
  centerOpen: boolean;
  reaped: number;
  /** The queue is observable: one line per event, what each tier did with it. */
  log: string[];
}

export type Action =
  | { type: "emit"; ev: DeskEvent }
  | { type: "tick"; dt: number }
  | { type: "dismiss"; id: string }
  | { type: "act"; id: string }
  | { type: "attend"; id: string; on: boolean }
  | { type: "ledger:read"; id: string }
  | { type: "ledger:read-all" }
  | { type: "ledger:act"; id: string }
  | { type: "center:toggle" }
  | { type: "os:set"; patch: Partial<Pick<OsState, "foregrounded" | "visibleSurface" | "platformUp">> }
  | { type: "os:pref"; kind: EventKind; channel: "inApp" | "os"; on: boolean }
  | { type: "os:request"; grant: boolean }
  | { type: "os:open"; id: string }
  | { type: "fleet:unwatch"; name: string }
  | { type: "rescan:fail"; name: string }
  | { type: "rescan:recover"; name: string }
  | { type: "announce:drain" };

export function initialDesk(fleet: string[]): DeskState {
  return { now: 0, seq: 0, queue: emptyQueue(), ledger: [], os: initialOs(), announcer: emptyAnnouncer(), fleet: fleet.map((name) => ({ name, status: "watched" })), rescans: {}, centerOpen: false, reaped: 0, log: [] };
}

function emit(s: DeskState, ev: DeskEvent, dwellOverride?: number): DeskState {
  const seq = s.seq + 1;
  const id = `evt-${seq}`;
  const key = semanticKey(ev);
  const led = record(s.ledger, ev, id, key, s.now);
  const q = admit(s.queue, ev, id, s.now, dwellOverride);
  const os = send(s.os, ev, id, key);
  const count = led.entries.find((e) => e.key === key && !e.resolved)?.count ?? s.queue.toasts.find((t) => t.key === key)?.count ?? 1;
  const update = q.outcome === "coalesced" || q.outcome === "suppressed";
  const text = update ? `${ev.title} — still, ${count} times` : ev.title;
  const announcer = enqueue(s.announcer, { key, text, politeness: politenessFor(ev.severity, !!ev.blocking), awareness: !ev.actionRequired });
  const line = `${id} ${ev.severity}${ev.actionRequired ? "·obligation" : ""} → toast ${q.outcome} · ledger ${led.outcome} · os ${os.decision.send ? "sent" : "held"} (${os.decision.reason})`;
  return { ...s, seq, ledger: led.entries, queue: q.state, os: os.os, announcer, log: [line, ...s.log].slice(0, 12) };
}

/** The one handler behind toast action, ledger action and click-through: idempotent, verified, addressed. */
function resolveEverywhere(s: DeskState, key: string, id: string, surface: Surface, title: string): DeskState {
  const announcer = enqueue(s.announcer, { key, text: `Resolved: ${title}`, politeness: "polite", awareness: true });
  return { ...s, ledger: resolveByKey(resolve(s.ledger, id), key), queue: retract(s.queue, key), os: { ...withdraw(s.os, key), visibleSurface: surface, foregrounded: true }, announcer };
}

function actOn(s: DeskState, t: Pick<Toast, "id" | "key" | "kind" | "subject" | "title" | "verb">): DeskState {
  if (t.kind === "summary" || t.verb === "Open center") return { ...s, centerOpen: true, queue: retract(s.queue, t.kind === "summary" ? SUMMARY_KEY : t.key) };
  if (t.verb === "Undo") {
    const fleet = s.fleet.map((r) => (r.name === t.subject ? { ...r, status: "watched" as const } : r));
    return { ...s, fleet, queue: retract(s.queue, t.key), announcer: enqueue(s.announcer, { key: t.key, text: `${t.subject} restored`, politeness: "polite", awareness: true }) };
  }
  if (t.verb === "Retry") {
    // Verified, not assumed: the world may have moved since the toast appeared.
    const stale = s.rescans[t.subject] !== "failed";
    const next = { ...s, queue: retract(s.queue, t.key), ledger: resolveByKey(s.ledger, t.key), os: withdraw(s.os, t.key) };
    if (stale) {
      const ack = { ...EVENTS.rescanRecovered(t.subject), title: `Nothing to retry — ${t.subject} already recovered` };
      // The acknowledgment replaces any live recovery toast for the same key rather than bumping its count.
      return emit({ ...next, queue: retract(next.queue, semanticKey(ack)) }, ack);
    }
    return emit({ ...next, rescans: { ...s.rescans, [t.subject]: "idle" } }, EVENTS.rescanQueued(t.subject));
  }
  return resolveEverywhere(s, t.key, t.id, KIND_META[t.kind].surface, t.title);
}

function commitExpired(s: DeskState, expired: Toast[]): DeskState {
  // Deferred delete: the undo window closing COMMITS. Expiry is reliable because it is state, not a stray timer.
  const gone = new Set(expired.filter((t) => t.kind === "repo-unwatched").map((t) => t.subject));
  if (gone.size === 0) return s;
  return { ...s, fleet: s.fleet.map((r) => (gone.has(r.name) && r.status === "pending-removal" ? { ...r, status: "removed" } : r)) };
}

export function reduce(s: DeskState, a: Action): DeskState {
  switch (a.type) {
    case "emit":
      return emit(s, a.ev);
    case "tick": {
      const now = s.now + a.dt;
      const q = tick(s.queue, a.dt, now);
      const r = reap(s.ledger, now);
      return commitExpired({ ...s, now, queue: q.state, ledger: r.entries, reaped: s.reaped + r.reaped, announcer: drainTick(s.announcer, a.dt, now) }, q.expired);
    }
    case "dismiss": {
      const t = s.queue.toasts.find((x) => x.id === a.id);
      if (!t) return s;
      // Explicit dismissal is deferral: the obligation stays live and unread in the ledger.
      return commitExpired({ ...s, queue: dismiss(s.queue, a.id, s.now) }, [t]);
    }
    case "act": {
      const t = s.queue.toasts.find((x) => x.id === a.id);
      return t ? actOn(s, t) : s;
    }
    case "attend":
      return { ...s, queue: attend(s.queue, a.id, a.on) };
    case "ledger:read": {
      const e = s.ledger.find((x) => x.id === a.id);
      return e ? { ...s, ledger: markRead(s.ledger, a.id), os: withdraw(s.os, e.key) } : s;
    }
    case "ledger:read-all":
      return { ...s, ledger: markAllRead(s.ledger), os: s.ledger.reduce((os, e) => withdraw(os, e.key), s.os) };
    case "ledger:act": {
      const e = s.ledger.find((x) => x.id === a.id);
      return e ? actOn(s, { id: e.id, key: e.key, kind: e.kind, subject: e.key.split(":")[1] ?? "", title: e.title, verb: e.verb }) : s;
    }
    case "center:toggle":
      return { ...s, centerOpen: !s.centerOpen };
    case "os:set":
      return { ...s, os: { ...s.os, ...a.patch } };
    case "os:pref":
      return { ...s, os: { ...s.os, prefs: { ...s.os.prefs, [a.kind]: { ...s.os.prefs[a.kind], [a.channel]: a.on } } } };
    case "os:request":
      return { ...s, os: { ...s.os, permission: a.grant ? "granted" : "denied" } };
    case "os:open": {
      const n = s.os.outbox.find((x) => x.id === a.id);
      const ledger = n ? s.ledger.map((e) => (e.key === n.key ? { ...e, read: true } : e)) : s.ledger;
      return { ...s, os: clickThrough(s.os, a.id), ledger, centerOpen: true };
    }
    case "fleet:unwatch": {
      const fleet = s.fleet.map((r) => (r.name === a.name ? { ...r, status: "pending-removal" as const } : r));
      return emit({ ...s, fleet }, EVENTS.repoUnwatched(a.name), UNDO_WINDOW_MS);
    }
    case "rescan:fail":
      return emit({ ...s, rescans: { ...s.rescans, [a.name]: "failed" } }, EVENTS.rescanFailed(a.name));
    case "rescan:recover":
      return emit({ ...s, rescans: { ...s.rescans, [a.name]: "recovered" } }, EVENTS.rescanRecovered(a.name));
    case "announce:drain":
      return { ...s, announcer: drainNow(s.announcer, s.now) };
  }
}
