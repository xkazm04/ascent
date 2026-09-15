// The durable tier (durable-notification-ledger): admission decided by the message's classification at
// the source — never by whether a toast happened to show — one identity shared with the toast and the
// OS note, read-state kept apart from resolution, a badge DERIVED from the rows under a named
// predicate, and retention that names its reaper per class and never ages out an obligation. Pure.

import type { DeskEvent } from "./fixtures";
import { SEVERITY_TABLE, type Severity } from "./severity";

export interface Entry {
  id: string;
  key: string;
  kind: DeskEvent["kind"];
  severity: Severity;
  title: string;
  verb: string | null;
  actionRequired: boolean;
  count: number;
  /** Unread means unseen — not unresolved. */
  read: boolean;
  /** The obligation's own state; a read obligation still demands its action. */
  resolved: boolean;
  createdAt: number;
  lastAt: number;
}

/** Retention, declared at the ledger. Scene seconds stand in for product days. */
export const RETENTION = { readAwarenessMs: 20_000, unreadAwarenessMs: 60_000, cap: 12 } as const;

export type Admission = "obligation" | "severity" | "awaited" | "none";

/** What earns a record: obligations always; warning+ always; success/info only when awaited. */
export function admission(ev: DeskEvent): Admission {
  if (ev.actionRequired) return "obligation";
  const rule = SEVERITY_TABLE[ev.severity].ledger;
  if (rule === "yes" || rule === "pinned") return "severity";
  if (rule === "if-awaited" && ev.awaited) return "awaited";
  return "none";
}

/** Record an event. A live (unresolved) entry with the same key is bumped — one fact with a count. */
export function record(entries: Entry[], ev: DeskEvent, id: string, key: string, now: number): { entries: Entry[]; outcome: "new" | "bumped" | "skipped"; entryId: string | null } {
  if (admission(ev) === "none") return { entries, outcome: "skipped", entryId: null };
  const open = entries.find((e) => e.key === key && !e.resolved);
  if (open) {
    return { entries: entries.map((e) => (e === open ? { ...e, count: e.count + 1, lastAt: now, read: false } : e)), outcome: "bumped", entryId: open.id };
  }
  const entry: Entry = { id, key, kind: ev.kind, severity: ev.severity, title: ev.title, verb: ev.verb, actionRequired: ev.actionRequired, count: 1, read: false, resolved: false, createdAt: now, lastAt: now };
  return { entries: cap([entry, ...entries]), outcome: "new", entryId: id };
}

export const markRead = (entries: Entry[], id: string): Entry[] => entries.map((e) => (e.id === id ? { ...e, read: true } : e));

/** Bulk read is legitimate for awareness; obligations are read too but stay unresolved, in their section. */
export const markAllRead = (entries: Entry[]): Entry[] => entries.map((e) => ({ ...e, read: true }));

/** Acting in either tier resolves the fact. Same identity, same handler. */
export const resolve = (entries: Entry[], id: string): Entry[] => entries.map((e) => (e.id === id ? { ...e, resolved: true, read: true } : e));

export const resolveByKey = (entries: Entry[], key: string): Entry[] => entries.map((e) => (e.key === key && !e.resolved ? { ...e, resolved: true, read: true } : e));

/** The badge: ONE predicate, chosen once, derived from the rows every time. Zero is reachable by reading. */
export function badge(entries: Entry[]): { predicate: "unread"; count: number } {
  return { predicate: "unread", count: entries.filter((e) => !e.read).length };
}

/** Obligations are a to-do list, not news: pinned apart. News is newest first. */
export function sections(entries: Entry[]): { obligations: Entry[]; news: Entry[] } {
  const obligations = entries.filter((e) => e.actionRequired && !e.resolved);
  const news = entries.filter((e) => !(e.actionRequired && !e.resolved));
  return { obligations, news };
}

/** The reaper. Read awareness leaves first, unread awareness later, unresolved obligations never. */
export function reap(entries: Entry[], now: number): { entries: Entry[]; reaped: number } {
  const kept = entries.filter((e) => {
    if (e.actionRequired && !e.resolved) return true;
    const age = now - e.lastAt;
    return e.read ? age < RETENTION.readAwarenessMs : age < RETENTION.unreadAwarenessMs;
  });
  return { entries: kept, reaped: entries.length - kept.length };
}

/** The cap backs the time rules: evict oldest-READ-first, then oldest unread awareness, never an open obligation. */
function cap(entries: Entry[]): Entry[] {
  if (entries.length <= RETENTION.cap) return entries;
  const evictable = entries.filter((e) => !(e.actionRequired && !e.resolved)).sort((a, b) => Number(b.read) - Number(a.read) || a.lastAt - b.lastAt);
  const drop = new Set(evictable.slice(0, entries.length - RETENTION.cap).map((e) => e.id));
  return entries.filter((e) => !drop.has(e.id));
}
