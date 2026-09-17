// After a live scan lands on `/report?repo=…`, the address bar still names the *job*, not the
// artifact. The durable URL is `/report/{owner}/{repo}` (reportPermalink) — but only once that
// path will actually resolve. Rewriting before persist would put a scored-looking permalink in
// the bar whose generateMetadata still says "No report yet" (cold-permalink honesty). A scoped
// live scan (`?ref=` / `?path=`) must not be rewritten — or copied — to that unscoped path.
//
// history.replaceState, not router.replace: `/report` is force-dynamic, so a router navigation
// remounts the server tree and can flash ColdScanGate over the report the user just waited for.

import { parseOwnerRepo } from "@/lib/repo-ref";
import { reportPermalink } from "@/lib/ui";

/** Query keys that belong to the live-scan job URL, not the durable permalink. */
export const LIVE_SCAN_PARAM_KEYS = ["repo", "fresh", "notify", "ref", "path"] as const;

/** Job keys that mean this reading is not the default-branch, whole-repo snapshot. */
export const LIVE_SCAN_SCOPE_KEYS = ["ref", "path"] as const;

/** True when the live-scan job URL itself is scoped (`?ref=` / `?path=`). */
export function searchHasLiveScanScope(search: string): boolean {
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  return LIVE_SCAN_SCOPE_KEYS.some((key) => Boolean(params.get(key)));
}

/** `/report/{owner}/{repo}` or `/report/{owner}/{repo}@{sha}` — not the `/report?repo=` job page. */
export function isReportPermalinkPath(pathname: string): boolean {
  return /^\/report\/[^/]+\/[^/]+$/.test(pathname);
}

/** Peek/salvage responses that came from the durable store, not the in-memory cache. */
export function peekWasDurable(headers: { get(name: string): string | null }): boolean {
  const cache = headers.get("x-ascent-cache");
  return cache === "hit-db" || cache === "hit-recent" || headers.get("x-ascent-stale") === "true";
}

/** The SSE `persisted` frame sent before `result`. Absent/malformed → not durable. */
export function persistedFrameOk(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { ok?: unknown }).ok === true;
}

/**
 * The URL to put in the address bar once THIS scan is in the durable store, or null when a
 * rewrite would lie (not persisted, scoped, already on the permalink, not a GitHub owner/name).
 */
export function liveScanPermalinkPath(input: {
  pathname: string;
  search: string;
  fullName: string;
  persisted: boolean;
  scoped?: boolean;
}): string | null {
  // Inspect the job URL, not only the caller's `scoped` flag: a `?ref=` / `?path=` live scan
  // must never be rewritten to `/report/{owner}/{repo}` (that path is a different artifact).
  if (!input.persisted || input.scoped || searchHasLiveScanScope(input.search)) return null;
  if (input.pathname !== "/report") return null;
  const parsed = parseOwnerRepo(input.fullName);
  if (!parsed) return null;
  const path = reportPermalink(`${parsed.owner}/${parsed.repo}`);
  const params = new URLSearchParams(input.search.replace(/^\?/, ""));
  for (const key of LIVE_SCAN_PARAM_KEYS) params.delete(key);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Durable `/report/{owner}/{repo}` the header Permalink control may copy, or null when this
 * reading is a scoped live scan. Copying the unscoped permalink from a branch/sub-path scan
 * would name a different artifact (the default-branch snapshot, or ColdScanGate).
 */
export function liveScanCopyPermalink(input: {
  fullName: string;
  search: string;
  headSha?: string | null;
  scoped?: boolean;
}): { path: string; pinnedPath?: string } | null {
  if (input.scoped || searchHasLiveScanScope(input.search)) return null;
  const path = reportPermalink(input.fullName);
  const pinnedPath = input.headSha ? reportPermalink(input.fullName, input.headSha) : undefined;
  return pinnedPath ? { path, pinnedPath } : { path };
}

/** Rewrite the address bar in place. Returns the new href, or null when nothing changed. */
export function rewriteLiveScanAddressBar(
  input: Parameters<typeof liveScanPermalinkPath>[0],
): string | null {
  const next = liveScanPermalinkPath(input);
  if (!next || typeof window === "undefined") return null;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === next) return null;
  window.history.replaceState(null, "", next);
  return next;
}

/** Section-tab href. After the address bar is the permalink, drop leftover live-scan query keys. */
export function reportSectionUrl(pathname: string, search: string, tab: string): string {
  const next = new URLSearchParams(search.replace(/^\?/, ""));
  if (tab === "scoring") next.delete("tab");
  else next.set("tab", tab);
  if (isReportPermalinkPath(pathname)) {
    for (const key of LIVE_SCAN_PARAM_KEYS) next.delete(key);
  }
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
