// Source excerpts for the mechanism drawer — verbatim from this scene's own files (severity.ts,
// queue.ts, desk.ts, ledger.ts, escalation.ts, announcer.ts and the panels). String constants so the
// drawer needs no build step; when the code moves, these move with it in the same commit.

export const SRC_SEVERITY = `// severity.ts — the closed set, and ONE row per level that every channel derives from
export const SEVERITIES = ["info", "success", "warning", "error", "critical"] as const;
export const SEVERITY_TABLE: Record<Severity, SeverityRow> = {
  warning: { tone: "cautionary", consequence: "something will degrade if unaddressed",
             dwellMs: 6_000, dismiss: "auto", ledger: "yes", osEligible: "if-actionable", politeness: "polite", cooldownMs: 10_000 },
  critical: { tone: "maximum", consequence: "the product cannot do its job until a human acts",
             dwellMs: 0, dismiss: "acted", ledger: "pinned", osEligible: "yes", politeness: "assertive", cooldownMs: 0 }, …
};
// tone → brand slots is the SECOND table; the severity table never names a colour
export const TONE_SLOTS: Record<Tone, { border; bg; text; dot }> = { cautionary: { border: "border-warn/40", … }, … };
export function dwellFor(severity, actionRequired, title) {            // actionability is the orthogonal bit
  const base = SEVERITY_TABLE[severity].dwellMs;
  if (actionRequired || base === 0) return null;                       // obligations carry no dwell
  return base + Math.max(0, title.length - 40) * 40;                   // scaled by reading length
}
export function politenessFor(severity, blocking) {                    // the grade is a table read
  const p = SEVERITY_TABLE[severity].politeness;
  return p === "assertive-if-blocking" ? (blocking ? "assertive" : "polite") : p;
}`;

export const SRC_QUEUE = `// queue.ts — identity keys everything; the semantic key drives coalescing and the cooldown
export function admit(q, ev, id, now, dwellOverride) {
  const key = semanticKey(ev);
  const live = q.toasts.find((t) => t.key === key);
  if (live) return { state: bump(q, key), outcome: "coalesced", id: live.id };   // one toast, a count
  if (now < (q.cooldownUntil[key] ?? -1)) return { state: countSuppressed(q), outcome: "suppressed", id };
  const toast = { id, key, …, dwellMs, remainingMs: dwellMs, attended: false };
  return { state: applyOverflow({ ...q, toasts: place(q.toasts, toast) }), … };  // severity preempts the lowest slot
}
function applyOverflow(q) {   // in order: coalesce same-kind waiters → summarize the tail → count every shed
  … rest = [merged, ...rest.filter((t) => !group.includes(t))];                 // "3 × rescan failed"
  … const summary = { kind: "summary", title: \`\${n} more notifications\`, verb: "Open center", dwellMs: null };
  shed += tail.length;   // the screen missed them; the ledger already has them (admission ran first)
}
export function tick(q, dt, now) {   // waiting toasts do not age; attention holds the clock
  q.toasts.forEach((t, i) => { if (i >= MAX_VISIBLE || t.attended || t.remainingMs === null) return keep(t); … });
}
export function dismiss(q, id, now) {   // removing the entry removes its only timer — nothing fires into a reused slot
  return applyOverflow(stamp({ ...q, toasts: q.toasts.filter((x) => x.id !== id) }, t.key, t.severity, now));
}`;

export const SRC_ACTION = `// desk.ts — the ONE handler behind toast action, ledger action and click-through
function actOn(s, t) {
  if (t.verb === "Undo") return restore(s, t.subject);                          // undo restores, fully
  if (t.verb === "Retry") {
    const stale = s.rescans[t.subject] !== "failed";                            // verified, not assumed
    if (stale) return emit(next, { …rescanRecovered(t.subject), title: \`Nothing to retry — \${t.subject} already recovered\` });
    return emit({ ...next, rescans: { …, [t.subject]: "idle" } }, EVENTS.rescanQueued(t.subject));
  }
  return resolveEverywhere(s, t.key, t.id, KIND_META[t.kind].surface, t.title); // lands AT the remedy
}
// deferred delete: the undo window's expiry COMMITS — reliable because expiry is state, not a stray timer
case "fleet:unwatch": return emit({ ...s, fleet: pending(a.name) }, EVENTS.repoUnwatched(a.name), UNDO_WINDOW_MS);
function commitExpired(s, expired) { … status: "removed" … }
// ToastCard.tsx — one verb, a separate dismiss target, attention (pointer OR focus) pauses the clock
<motion.li onPointerEnter={() => onAttend(true)} onFocus={() => onAttend(true)} onBlur={blur} onKeyDown={key}>
  <button onClick={onAct} aria-label={\`\${toast.verb}: \${toast.title}\`}>{toast.verb}</button>
  <button onClick={onDismiss} aria-label={\`Dismiss: \${toast.title}\`}>✕</button>`;

export const SRC_LEDGER = `// ledger.ts — admission at the source; one identity; read ≠ resolved; the badge is derived
export function admission(ev) {
  if (ev.actionRequired) return "obligation";                                  // always
  const rule = SEVERITY_TABLE[ev.severity].ledger;                             // warning+ always
  if (rule === "if-awaited" && ev.awaited) return "awaited";                   // success/info only when awaited
  return "none";
}
export function record(entries, ev, id, key, now) {   // a live same-key entry is bumped: one fact with a count
  const open = entries.find((e) => e.key === key && !e.resolved);
  if (open) return bump(open); …
}
export function badge(entries) {                      // ONE predicate, chosen once, recomputed from the rows
  return { predicate: "unread", count: entries.filter((e) => !e.read).length };
}
export const RETENTION = { readAwarenessMs: 20_000, unreadAwarenessMs: 60_000, cap: 12 };
export function reap(entries, now) {                  // read news first, unread later, obligations never
  return entries.filter((e) => (e.actionRequired && !e.resolved) || age(e) < (e.read ? RETENTION.readAwarenessMs : RETENTION.unreadAwarenessMs));
}
// desk.ts — emit writes the record BEFORE the queue decides the pixels; acting anywhere resolves everywhere
const led = record(s.ledger, ev, id, key, s.now); const q = admit(s.queue, ev, id, s.now); const os = send(s.os, ev, id, key);`;

export const SRC_OS = `// escalation.ts — the send-time decision, then a fallible send whose failure never costs the record
export function decide(os, ev) {
  if (!os.prefs[ev.kind].os) return { send: false, reason: "vetoed by the user's cell for this kind" };
  if (SEVERITY_TABLE[ev.severity].osEligible === "no") return { send: false, reason: \`\${ev.severity} is never eligible\` };
  if (os.permission !== "granted") return { send: false, reason: os.permission === "denied"
      ? "permission denied — routed in-app + ledger, and said so" : "permission never asked — routed in-app + ledger" };
  if (os.foregrounded && os.visibleSurface === ev.surface) return { send: false, reason: \`the user is looking at \${ev.surface} right now\` };
  return { send: true, reason: os.foregrounded ? \`app foregrounded but \${ev.surface} is not visible\` : "app is backgrounded" };
}
export function send(os, ev, id, key) {
  const live = os.outbox.find((n) => n.key === key && n.status === "sent");
  if (live) return updateInPlace(live);                                          // coalescing extends outward
  const note = { id, key, title: ev.title, status: os.platformUp ? "sent" : "failed", surface: ev.surface };
  if (!os.platformUp) return { os: { …, failures: os.failures + 1 }, decision: { send: false, reason: "platform refused the send — logged; the toast and the ledger row stand" } };
}
export const withdraw = (os, key) => …status: "withdrawn"…;   // reading in one tier retires the others
export const clickThrough = (os, id) => ({ ...withdraw(os, note.key), foregrounded: true, visibleSurface: note.surface });`;

export const SRC_ANNOUNCE = `// AnnouncerPanel.tsx — the regions exist before the news, empty, and are only written into
<div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-live="polite">{regionText(a.polite, a.nonce)}</div>
<div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only" data-live="assertive">{regionText(a.assertive, a.nonce)}</div>
// announcer.ts — one writer, its own serial queue, coalesced by key, assertive first, bounded
export function enqueue(a, u) {
  let queue = a.queue.filter((q) => q.key !== u.key);                       // the update replaces the original
  queue = u.politeness === "assertive" ? [u, ...queue] : [...queue, u];     // jumps the queue, erases nothing
  while (queue.length > QUEUE_CAP) { drop oldest polite awareness; dropped += 1; }
}
export function drainNow(a, now) {                                          // one drain = one region mutation
  const [next, ...rest] = a.queue;
  return { ...a, [next.politeness]: next.text, queue: rest, nonce: a.nonce + 1, cooldownMs: DRAIN_GAP_MS };
}
// desk.ts — politeness came from the severity table when the event was emitted; a repeat announces the update
enqueue(s.announcer, { key, text: update ? \`\${ev.title} — still, \${count} times\` : ev.title, politeness: politenessFor(ev.severity, !!ev.blocking), … });`;
