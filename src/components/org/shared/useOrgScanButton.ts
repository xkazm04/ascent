"use client";

// State/handlers for the org "Scan all watched" button (OrgScanButton.tsx). Owns no JSX — split out
// per docs/ORG-TABS-REFACTOR.md's extraction order to bring OrgScanButton.tsx under the 200-LOC cap.
//
// This hook composes `useScanStream` (the shared SSE transport, also used by RepoRescanButton) but is
// NOT a replacement for it — useScanStream stays transport-only by design; this hook is where
// OrgScanButton's own Progress state lives, same as it did inline in the component before the split.

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useScanStream } from "@/components/org/shared/useScanStream";
import { consumeUpgradeScanFlag } from "@/components/onboarding/upgradeScan";
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
  /** Set when the server stopped claiming new work to stay inside its wall-clock budget. Since
   *  moonshot #10 the remainder is a DURABLE QUEUE, not a list the user must re-drive: the background
   *  worker finishes it, and this carries the run handle so the hook can poll how much is left. Kept
   *  strictly separate from `error` — a budget-stopped run scanned (and persisted) real repos. */
  queued?: { runId: string; pending: number; total: number };
  error?: string;
}

/** How often the background remainder is re-read. Slow on purpose: the work is durable and a cron
 *  pass is minutes away, so a tighter poll would buy nothing and cost a query per tick. */
const QUEUE_POLL_MS = 15_000;

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
    // A run already in flight is always refused. `noWatched` refuses only an UNSCOPED run: it exists
    // because "Scan all watched (0)" would have nothing to walk. A scope that NAMES its repos (the
    // truncated-run "Continue", W6b's preview-then-upgrade auto-start) carries its own work list, and
    // the server intersects it with the watchlist anyway — refusing it here on a possibly-stale
    // watchedCount (a client-router-cached layout payload) would silently swallow the auto-start.
    if (p.running || (noWatched && !scope?.repos?.length)) return;
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
        } else if (event === "queued") {
          // The run hit its server-side wall-clock budget and stopped claiming NEW work. Everything it
          // did scan is already persisted, and the remainder is a queued job the background worker
          // finishes with no further action from the user. Deliberately NOT the error state.
          const pendingN = Number(data.queued);
          const totalN = Number(data.total);
          const runId = String(data.runId ?? "");
          if (runId) {
            setP((s) => ({
              ...s,
              queued: {
                runId,
                pending: Number.isFinite(pendingN) ? pendingN : 0,
                total: Number.isFinite(totalN) ? totalN : s.total,
              },
            }));
          }
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

  // W6b preview-then-upgrade auto-start: the onboarding wizard's "fast preview first" run leaves a
  // one-shot sessionStorage flag naming this org + the just-previewed repos; consume it on mount and
  // start the LIVE scan of exactly those repos through this hook's own `run` — the same header
  // stream, meter, credit disclosures, and refusal surface as a manual click. Mounted by the org
  // LAYOUT (OrgShellActions), so the stream survives `?tab=` navigation while engine-aware dedup
  // upgrades the preview rows in place.
  //
  // Guard rails: `consumeUpgradeScanFlag` removes the key BEFORE the run starts (a refresh — or
  // StrictMode's doubled effect — can never fire a second billable run) and drops stale/foreign-org
  // flags; the SERVER stays the authority on membership (requireOrgAccess) and money
  // (checkScanEntitlement + per-repo reservation → the 402/notice surfaces this hook already
  // renders), so a crafted flag can never scan an org the viewer can't, nor spend past the balance.
  // `autoStarted` keeps the effect idempotent within one mount without widening its deps.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    const repos = consumeUpgradeScanFlag(org);
    if (!repos) return;
    autoStarted.current = true;
    // Deferred one microtask so `run`'s synchronous head (the initial "running" setP) executes as an
    // async continuation rather than inside the effect body (react-hooks/set-state-in-effect). No
    // cancelling cleanup on purpose: the flag is already consumed, and StrictMode's doubled effect
    // (effect → cleanup → effect) re-enters with `autoStarted` latched — a cancel in the cleanup
    // would silently swallow the one-shot handoff.
    void Promise.resolve().then(() => run({ repos }));
    // Mount-only by design: the flag is one-shot and `run` is stable for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PASSIVE POLL of a budget-stopped run's remainder (moonshot #10). The old UI handed the user a
  // "Continue (N left)" button — i.e. asked them to re-drive work the server had dropped. The server
  // no longer drops it, so the honest surface is a count that ticks down on its own. The poll is
  // read-only, costs one small query, and stops the moment nothing is pending.
  const queuedRunId = p.queued?.runId;
  useEffect(() => {
    if (!queuedRunId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/org/scan/queue?org=${encodeURIComponent(org)}&runId=${encodeURIComponent(queuedRunId)}`);
        // A failed poll is NOT evidence the work vanished — keep the last known count rather than
        // silently showing "finished" for a run still in the queue.
        if (!res.ok || cancelled) return;
        const d = (await res.json()) as { pending?: number };
        const pending = Number(d.pending);
        if (cancelled || !Number.isFinite(pending)) return;
        setP((s) => (s.queued?.runId === queuedRunId ? { ...s, queued: pending > 0 ? { ...s.queued, pending } : undefined } : s));
        if (pending === 0) router.refresh(); // the fleet's rows are now current — reload them
      } catch {
        // Network blip: same reasoning as a non-ok response — say nothing rather than something false.
      }
    };
    const id = setInterval(tick, QUEUE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [org, queuedRunId, router]);

  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  // The curated demo org is seeded with synthetic histories, not live-scannable repos — a "Stale only"
  // rescan there has nothing real to refresh, so hide it (the full "Scan all watched" stays for the
  // demo walkthrough). Slug is the canonical lower-cased org row casing; DEMO_ORG_SLUG is pre-lowered.
  const isDemoOrg = org.trim().toLowerCase() === DEMO_ORG_SLUG;

  return { p, hintId, noWatched, inert, run, pct, isDemoOrg };
}
