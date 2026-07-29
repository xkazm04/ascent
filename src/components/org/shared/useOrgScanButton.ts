"use client";

// State/handlers for the org "Scan all watched" button (OrgScanButton.tsx). Owns no JSX — split out
// per docs/ORG-TABS-REFACTOR.md's extraction order to bring OrgScanButton.tsx under the 200-LOC cap.
//
// This hook composes `useScanStream` (the shared SSE transport, also used by RepoRescanButton) but is
// NOT a replacement for it — useScanStream stays transport-only by design; this hook is where
// OrgScanButton's own Progress state lives, same as it did inline in the component before the split.

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useScanStream } from "@/components/org/shared/useScanStream";
import { DEMO_ORG_SLUG } from "@/lib/site";

interface Progress {
  running: boolean;
  done: number;
  total: number;
  current: string;
  /** Per-repo scan failures observed during the bulk run (from the server's `repo` events). */
  failed: number;
  /** Repos skipped for lack of prepaid scan credits (`notice` up front, `repo.skipped` mid-run,
   *  authoritative total on the final `result`) — a truncated paid run must not read as success. */
  skipped: number;
  /** Set when the server stopped issuing new repos to stay inside its wall-clock budget. Carries the
   *  exact remainder so "Continue" walks what's LEFT rather than re-driving the whole fleet. Kept
   *  strictly separate from `error`: a truncated run scanned (and persisted) real repos. */
  truncated?: { scanned: number; total: number; repos: string[] };
  error?: string;
}

/** Scope for one bulk-scan request — the stale-only filter, or an explicit remainder to continue. */
export type ScanScope = { staleOnlyDays?: number; repos?: string[] };

export function useOrgScanButton(org: string, watchedCount: number) {
  const router = useRouter();
  const startScan = useScanStream();
  const [p, setP] = useState<Progress>({ running: false, done: 0, total: watchedCount, current: "", failed: 0, skipped: 0 });
  const hintId = useId();
  // a11y (ambiguity-ui 2026-07-16 #5): natively-disabled buttons leave the tab order and `title` is
  // hover-only, so keyboard/SR users found dead controls with no reason. Keep them focusable with
  // aria-disabled + a run guard; the no-watched reason is exposed via aria-describedby → sr-only
  // hint (the visible "Watch repos on Connect →" link below carries the same path for everyone).
  const noWatched = watchedCount === 0;
  const inert = p.running || noWatched;

  async function run(scope?: ScanScope) {
    if (inert) return;
    // For a SCOPED (stale-only) scan the count isn't known up front — the server picks the stale subset
    // — so start the denominator at 0 and let the server's first progress/notice event fill it in,
    // rather than showing a misleading "0/<all watched>" (or an instant 100% on a tiny stale subset).
    // A CONTINUE scope names its repos explicitly, so its denominator IS known.
    const initialTotal = scope?.repos ? scope.repos.length : scope ? 0 : watchedCount;
    setP({ running: true, done: 0, total: initialTotal, current: "starting…", failed: 0, skipped: 0 });
    await startScan({
      body: { org, ...scope },
      onRefused: (d, status) => setP((s) => ({ ...s, running: false, error: d?.error ?? `Failed (${status}).` })),
      onMessage: ({ event, data }) => {
        if (!data) return;
        if (event === "progress")
          setP((s) => ({ ...s, done: Number(data.index) || s.done, total: Number(data.total) || s.total, current: String(data.repo ?? "") }));
        else if (event === "repo") {
          // The server emits one `repo` event per repo: `error` on a per-repo failure, `skipped`
          // when a mid-run credit reservation was lost (no score produced). The old consumer
          // ignored both, so a partial run still read as N/N success — count them so the partial
          // outcome is visible.
          if (data.error) setP((s) => ({ ...s, failed: s.failed + 1 }));
          else if (data.skipped) setP((s) => ({ ...s, skipped: s.skipped + 1 }));
        } else if (event === "notice") {
          // Up-front partial coverage: the prepaid balance covers only `scanning` of the watched
          // repos; the rest are skipped before the run starts. Count them and let `scanning` fix
          // the denominator (also fills the unknown total of a scoped run).
          const skippedN = Number(data.skipped);
          const scanning = Number(data.scanning);
          setP((s) => ({
            ...s,
            skipped: s.skipped + (Number.isFinite(skippedN) && skippedN > 0 ? skippedN : 0),
            total: Number.isFinite(scanning) && scanning > 0 ? scanning : s.total,
          }));
        } else if (event === "truncated") {
          // The run hit its server-side wall-clock budget and stopped issuing NEW repos. Everything it
          // did scan is already persisted; the named remainder was never touched. This is deliberately
          // NOT the error state — the transport succeeded.
          const repos = Array.isArray(data.repos) ? (data.repos as unknown[]).map(String) : [];
          const scannedN = Number(data.scanned);
          const totalN = Number(data.total);
          setP((s) => ({
            ...s,
            truncated: {
              scanned: Number.isFinite(scannedN) ? scannedN : s.done,
              total: Number.isFinite(totalN) ? totalN : s.total,
              repos,
            },
          }));
        } else if (event === "result") {
          // Final summary — skippedForCredits is the authoritative total (up-front slice +
          // mid-run reservation losses), so prefer it over the incremental count.
          const skippedN = Number(data.skippedForCredits);
          if (Number.isFinite(skippedN)) setP((s) => ({ ...s, skipped: skippedN }));
        } else if (event === "error") setP((s) => ({ ...s, running: false, error: String(data.error) }));
      },
      onStreamEnd: () => {
        setP((s) => ({ ...s, running: false, current: "" }));
        router.refresh();
      },
      onNetworkError: () => setP((s) => ({ ...s, running: false, error: "Network error." })),
    });
  }

  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  // The curated demo org is seeded with synthetic histories, not live-scannable repos — a "Stale only"
  // rescan there has nothing real to refresh, so hide it (the full "Scan all watched" stays for the
  // demo walkthrough). Slug is the canonical lower-cased org row casing; DEMO_ORG_SLUG is pre-lowered.
  const isDemoOrg = org.trim().toLowerCase() === DEMO_ORG_SLUG;

  return { p, hintId, noWatched, inert, run, pct, isDemoOrg };
}
