// The scan RESUME ANCHOR: the one durable breadcrumb that lets a reloaded tab recognise a scan it
// already started, instead of treating the page as a cold first load.
//
// WHY A CLIENT-SIDE ANCHOR AT ALL. A live scan on /report?repo= is owned by one browser connection. On
// remount the hook has no way to tell "I have never scanned this" from "I started this scan 4 minutes
// ago and the page reloaded": nothing is persisted mid-scan, so the cache peek cannot hit, and the hook
// starts a SECOND full GitHub ingest plus LLM completion. At the measured claude-cli median (360s,
// scanEstimate.ts) that is six minutes of wall clock and a second inference bill for a page refresh.
// With the anchor the hook skips the peek, goes straight to the stream, and the server's coalescer
// (coalesceScan's linger window, src/lib/cache.ts) hands it the run already under way.
//
// PURE BY DESIGN. Every read takes its clock and its TTL as arguments and its storage as an injected
// accessor, so the subject match, the expiry and the throwing-accessor degrade are all unit-testable
// without a DOM — and a browser whose storage throws (private mode, blocked site data) reads as "no
// anchor" rather than breaking the scan it was meant to rescue.

/** The storage surface this module needs — structurally `sessionStorage`, injected so it is testable. */
export interface ScanAnchorStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Everything that makes one scan a DIFFERENT scan from another. A ref or a sub-path is a different
 *  subject, not the same scan with an option, so an anchor for the whole repo must never be claimed by
 *  a scoped run (it would rejoin a run scoring something else). */
export interface ScanAnchorSubject {
  repo: string;
  fresh: boolean;
  ref?: string;
  subPath?: string;
}

/** What a live anchor tells the hook: when the scan it names actually started. */
export interface ScanAnchor {
  startedAt: number;
}

/** ONE slot: a tab runs at most one interactive scan, so a later scan replaces the anchor rather than
 *  accumulating keys the next visit would have to garbage-collect. */
const ANCHOR_KEY = "ascent:scan-anchor";

/**
 * The stable identity of a scan subject. Repo casing is collapsed the way the scan pipeline's own cache
 * key is (normalizeRepoName), so `/report?repo=Acme/Web` and `?repo=acme/web` are the same scan and a
 * case-only URL difference across a reload still rejoins.
 */
export function scanAnchorSubject(subject: ScanAnchorSubject): string {
  const repo = subject.repo.trim().toLowerCase();
  return `${repo}|${String(subject.fresh)}|${subject.ref ?? ""}|${subject.subPath ?? ""}`;
}

/** Resolve the browser's session storage, or null where there is none (a server render) or where
 *  touching it throws (private mode, blocked site data). Never throws. */
export function defaultScanAnchorStore(): ScanAnchorStore | null {
  try {
    const store = globalThis.sessionStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

/** Record that THIS tab started THIS scan at `startedAt`. Best-effort: a storage that refuses simply
 *  means no rejoin is possible, which is today's behaviour, not a failure to surface. */
export function writeScanAnchor(store: ScanAnchorStore | null, subject: string, startedAt: number): void {
  if (!store) return;
  try {
    store.setItem(ANCHOR_KEY, JSON.stringify({ subject, startedAt }));
  } catch {
    /* storage unavailable — no anchor, so the next visit is an ordinary cold load */
  }
}

/**
 * Drop the anchor. Called when a scan SETTLES, so the next visit cannot claim a rejoin of a run that no
 * longer exists, and by the start-over control.
 *
 * `subject` makes it a no-op when the slot names a DIFFERENT scan. There is one slot per tab, so a scan
 * that settles from the cache (a peek hit on another repo) must not evict the anchor of a run that is
 * still going; without the guard, navigating to a second repo and back would silently disarm the rejoin.
 */
export function clearScanAnchor(store: ScanAnchorStore | null, subject?: string): void {
  if (!store) return;
  try {
    if (subject !== undefined) {
      const raw = store.getItem(ANCHOR_KEY);
      if (!raw) return;
      let held: unknown;
      try {
        held = JSON.parse(raw);
      } catch {
        store.removeItem(ANCHOR_KEY); // unreadable: it can only mislead a later read
        return;
      }
      if ((held as { subject?: unknown } | null)?.subject !== subject) return;
    }
    store.removeItem(ANCHOR_KEY);
  } catch {
    /* storage unavailable — nothing was written either */
  }
}

/**
 * The live anchor for `subject`, or null. Null covers every reason a rejoin must not be attempted: no
 * anchor, a different subject, a garbled value, an expired one, or a storage accessor that throws.
 *
 * `ttlMs` is the caller's scan-timeout horizon (scanClientTimeoutMs): past it the client has already
 * given up on the run, so the server's run is gone too and a rejoin would hang on nothing. An EXPIRED
 * anchor is swept on read rather than left to be re-evaluated on every later visit.
 */
export function readScanAnchor(
  store: ScanAnchorStore | null,
  subject: string,
  at: { now: number; ttlMs: number },
): ScanAnchor | null {
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(ANCHOR_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const bag = parsed as { subject?: unknown; startedAt?: unknown };
  if (typeof bag.subject !== "string" || typeof bag.startedAt !== "number" || !Number.isFinite(bag.startedAt)) {
    return null;
  }
  if (at.now - bag.startedAt > at.ttlMs) {
    clearScanAnchor(store);
    return null;
  }
  if (bag.subject !== subject) return null;
  return { startedAt: bag.startedAt };
}
