// WHAT A "SEEN" STAMP MAY CLAIM (session-resume/last-seen-anchors).
//
// A read-state stamp says "the viewer has seen everything up to here". Both surfaces that write one -
// the Alerts chip (`alertsSeenAt`) and the live ledger (`liveSeenAt`) - load what they show at one
// moment and acknowledge it at a later one: the chip fetches on mount and is opened whenever the viewer
// gets to it, the ledger loads on the server and stamps after five visible seconds, which for a tab
// opened in the background can be hours later. Stamping the server clock at acknowledgment marks
// everything that moved in between as seen without it ever being on screen, and it never comes back.
//
// So the client sends `through` - the moment its view was evaluated, or the newest item it showed -
// and the stamp is that, clamped to now (a future `through` cannot pre-acknowledge what has not
// happened). A missing or unreadable `through` falls back to now, the old behaviour, so an older
// client keeps working.

export function seenThrough(through: unknown, now: Date): Date {
  if (typeof through !== "string") return now;
  const ms = Date.parse(through);
  if (!Number.isFinite(ms)) return now;
  return ms < now.getTime() ? new Date(ms) : now;
}
