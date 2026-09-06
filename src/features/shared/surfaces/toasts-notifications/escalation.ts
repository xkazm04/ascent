// The third tier (os-escalation), simulated: a decision at SEND time per message — the user's per-kind
// preference, the permission state the app models (denied is a state, not a forgotten error), and
// focus-awareness against the surface the message is about — then a fallible send whose failure
// degrades reach, never the record. Reading in-app withdraws the note; a coalesced repeat updates one
// note in place. Pure: the "platform" is a boolean here.

import { KIND_META, type DeskEvent, type EventKind, type Surface } from "./fixtures";
import { SEVERITY_TABLE } from "./severity";

export type Permission = "unasked" | "granted" | "denied";
export type Channels = { inApp: boolean; os: boolean };

export interface OsNote {
  id: string;
  key: string;
  title: string;
  count: number;
  status: "sent" | "withdrawn" | "failed";
  /** Where click-through lands — full addressing carried in the note. */
  surface: Surface;
}

export interface OsState {
  permission: Permission;
  foregrounded: boolean;
  visibleSurface: Surface | "none";
  platformUp: boolean;
  prefs: Record<EventKind, Channels>;
  outbox: OsNote[];
  /** Sends the platform refused — telemetry the app keeps, the user never loses the ledger for. */
  failures: number;
}

export const KINDS = Object.keys(KIND_META) as EventKind[];

/** Defaults follow the admission rules; the user's cells win over them in both directions. */
export const defaultPrefs = (): Record<EventKind, Channels> =>
  Object.fromEntries(KINDS.map((k) => [k, { inApp: true, os: KIND_META[k].osDefault }])) as Record<EventKind, Channels>;

export const initialOs = (): OsState => ({ permission: "unasked", foregrounded: true, visibleSurface: "scans", platformUp: true, prefs: defaultPrefs(), outbox: [], failures: 0 });

export interface Decision {
  send: boolean;
  reason: string;
}

/** The send-time decision, in the order the reasons are cheapest to state. */
export function decide(os: OsState, ev: DeskEvent): Decision {
  if (!os.prefs[ev.kind].os) return { send: false, reason: "vetoed by the user's cell for this kind" };
  if (SEVERITY_TABLE[ev.severity].osEligible === "no") return { send: false, reason: `${ev.severity} is never eligible` };
  if (os.permission !== "granted") return { send: false, reason: os.permission === "denied" ? "permission denied — routed in-app + ledger, and said so" : "permission never asked — routed in-app + ledger" };
  if (os.foregrounded && os.visibleSurface === ev.surface) return { send: false, reason: `the user is looking at ${ev.surface} right now` };
  return { send: true, reason: os.foregrounded ? `app foregrounded but ${ev.surface} is not visible` : "app is backgrounded" };
}

/** A fallible send with a result. Coalescing extends outward: a live note for the key is updated in place. */
export function send(os: OsState, ev: DeskEvent, id: string, key: string): { os: OsState; decision: Decision } {
  const decision = decide(os, ev);
  if (!decision.send) return { os, decision };
  const live = os.outbox.find((n) => n.key === key && n.status === "sent");
  if (live) {
    return { os: { ...os, outbox: os.outbox.map((n) => (n === live ? { ...n, count: n.count + 1, title: ev.title } : n)) }, decision: { send: true, reason: "updated the live note in place" } };
  }
  const note: OsNote = { id, key, title: ev.title, count: 1, status: os.platformUp ? "sent" : "failed", surface: ev.surface };
  if (!os.platformUp) return { os: { ...os, outbox: [note, ...os.outbox], failures: os.failures + 1 }, decision: { send: false, reason: "platform refused the send — logged; the toast and the ledger row stand" } };
  return { os: { ...os, outbox: [note, ...os.outbox] }, decision };
}

/** Reading or resolving in one tier retires the note in the other. */
export function withdraw(os: OsState, key: string): OsState {
  return { ...os, outbox: os.outbox.map((n) => (n.key === key && n.status === "sent" ? { ...n, status: "withdrawn" } : n)) };
}

/** Click-through: the app comes forward AND lands on the note's surface. */
export function clickThrough(os: OsState, id: string): OsState {
  const note = os.outbox.find((n) => n.id === id);
  if (!note) return os;
  return { ...withdraw(os, note.key), foregrounded: true, visibleSurface: note.surface };
}

/** A blocked channel the user asked for is a state the app states — never a silent fall-through. */
export function blockedKinds(os: OsState): EventKind[] {
  if (os.permission !== "denied") return [];
  return KINDS.filter((k) => os.prefs[k].os);
}
