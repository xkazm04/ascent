// Pure model behind the shared error card (RouteError.tsx). No React, no DOM globals beyond the
// guarded browserRetryStore() accessor, so every rule here is unit-testable and client-safe.
//
// Three jobs:
//   1. COUNT RETRIES. A deterministic failure re-throws after "Try again" and the remounted card looks
//      identical, so the user cannot tell the retry happened. The count lives in sessionStorage (per tab,
//      per error) and after ESCALATE_AFTER failed tries the primary action becomes "report", because a
//      retry suggestion on a failure that is not transient is worse than none.
//   2. A PREFILLED REPORT that carries only the digest (the server-log correlation handle) and a
//      REDACTED route. Capability-link pages (/live/shared/<token>, /share/briefing/<token>,
//      /invite/<token>) have no error.tsx of their own, so their throw lands in the root card with the
//      token in the path: the token segment, the query string and the fragment are stripped before
//      anything leaves the page. Never the message or the stack (the no-raw-leak contract pinned in
//      src/app/error.test.ts extends to the outbound link).
//   3. ONE SENTRY CAPTURE per error key, however many times the boundary remounts.

import { FEEDBACK_URL, SOURCE_REPO_URL } from "@/lib/site";

/** The two calls the counter needs; sessionStorage satisfies it, and a test passes a Map-backed one. */
export type RetryStore = Pick<Storage, "getItem" | "setItem">;

export const RETRY_STORAGE_PREFIX = "ascent:route-error:v1:";
/** Failed retries after which the card stops suggesting another retry first. */
export const ESCALATE_AFTER = 2;

/** Path prefixes whose next segment is a bearer capability (share or invite token). */
const TOKEN_PREFIXES = ["/live/shared/", "/share/briefing/", "/invite/"] as const;

/** Drop the query string and fragment, and replace a capability token segment with `[token]`. */
export function redactPath(path: string): string {
  const bare = (path.split(/[?#]/, 1)[0] ?? "").trim() || "/";
  for (const prefix of TOKEN_PREFIXES) {
    if (bare.startsWith(prefix)) {
      const rest = bare.slice(prefix.length);
      const slash = rest.indexOf("/");
      return `${prefix}[token]${slash === -1 ? "" : rest.slice(slash)}`;
    }
  }
  return bare;
}

/** Short non-cryptographic hash (djb2) so a digest-less key distinguishes two errors on one route
 *  without storing the raw message. */
function shortHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The identity of one failure: its digest when the server gave one, otherwise a path-scoped key so a
 *  digest-less client throw still counts its retries. */
export function errorKey(error: { digest?: string; message?: string }, path: string): string {
  if (error.digest) return error.digest;
  return `route:${redactPath(path)}:${shortHash(error.message ?? "")}`;
}

/** The tab's sessionStorage, or null where there is none (SSR) or it is blocked. Never throws. */
export function browserRetryStore(): RetryStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Retries recorded for this key; 0 when nothing is stored, the store is blocked, or the value is junk. */
export function readAttempts(store: RetryStore | null, key: string): number {
  if (!store) return 0;
  try {
    const n = Number.parseInt(store.getItem(RETRY_STORAGE_PREFIX + key) ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export interface RetryState {
  attempts: number;
  escalated: boolean;
}

/** Count one more retry. A store that cannot write degrades to attempts 0 (the pre-counter behaviour)
 *  rather than throwing out of a click handler. */
export function recordRetry(store: RetryStore | null, key: string): RetryState {
  if (!store) return { attempts: 0, escalated: false };
  try {
    const attempts = readAttempts(store, key) + 1;
    store.setItem(RETRY_STORAGE_PREFIX + key, String(attempts));
    return { attempts, escalated: attempts >= ESCALATE_AFTER };
  } catch {
    return { attempts: 0, escalated: false };
  }
}

export interface ErrorActions {
  primary: "retry" | "report";
  /** Whether the report action (link or copy fallback) is offered at all. */
  showReport: boolean;
  escalated: boolean;
  retryLabel: string;
}

/** What the card offers, in what order, for a given retry count. */
export function actionsFor({ attempts }: { attempts: number }): ErrorActions {
  const escalated = attempts >= ESCALATE_AFTER;
  const retryLabel = attempts > 0 ? `Try again (${attempts} ${attempts === 1 ? "try" : "tries"} so far)` : "Try again";
  return { primary: escalated ? "report" : "retry", showReport: escalated, escalated, retryLabel };
}

export interface ReportInput {
  digest?: string;
  /** The current location; redacted here, so a caller may pass the raw pathname + search + hash. */
  path: string;
  /** The boundary's logLabel, so the report names which boundary caught it. */
  label: string;
}

/** The plain-text report: digest, redacted route, boundary. Picks its three fields explicitly so
 *  handing it a whole Error (message, stack) cannot leak them. */
export function reportDetails({ digest, path, label }: ReportInput): string {
  return [
    "An error screen in Ascent would not clear after retrying.",
    "",
    `Reference: ${digest || "(none)"}`,
    `Route: ${redactPath(path)}`,
    `Boundary: ${label}`,
    "",
    "What were you doing when it happened?",
  ].join("\n");
}

/** The issue tracker this deployment names, or null when it names none (the card then offers
 *  "Copy details" instead of sending a stranger's tracker a report about this deployment). */
export function issueTrackerBase(): string | null {
  return SOURCE_REPO_URL ? FEEDBACK_URL : null;
}

/** A prefilled new-issue link on the tracker. Carries {@link reportDetails} only. */
export function reportHref(input: ReportInput, base: string = FEEDBACK_URL): string {
  const title = `Error screen: ${redactPath(input.path)}${input.digest ? ` (ref ${input.digest})` : ""}`;
  const query = new URLSearchParams({ title, body: reportDetails(input) });
  return `${base.replace(/\/+$/, "")}/new?${query.toString()}`;
}

const capturedKeys = new Set<string>();

/** True the first time a key is seen (per page load), so a remounting boundary captures once. */
export function shouldCapture(key: string, seen: Set<string> = capturedKeys): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}
