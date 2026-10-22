"use client";

// The launch map's org scan, on the shared scan-run pieces instead of a hand-rolled third fold of
// POST /api/org/scan. Transport: useScanStream (now with an optional AbortSignal, so unmount still
// cancels). Run bookkeeping: scanRunRosterModel's foldStreamFrame / foldQueueSnapshot, the same fold
// the dashboard's "Scan all watched" uses. Card copy: fleetScanOutcome (pure). Stars: still painted
// per frame by the unchanged applyScanEvent.
//
// It also owns the three refs useFleetData's live refresh reads (scanCtrl / scanGen / recentScan),
// with the same contract FleetMap kept inline: scanCtrl is set for the life of a stream, scanGen is
// bumped at each scan start, recentScan stamps the org when its stream ends.
//
// A budget-stopped run's `queued` remainder is followed through startQueueFollow (the shared ceiling)
// until it drains; then the org's recentScan marker is cleared and its /api/app/repos list pulled once,
// instead of the map deferring that org for SCAN_SETTLE_MS and never reading the remainder at all.
//
// runPlan executes a fleetScopeModel plan ("Scan what you filtered") as ONE pending batch: each run is
// an ordinary scoped scan, one org at a time under the same lock; Cancel stops it before the next org
// (the in-flight org finishes, so nothing it was charged for is thrown away); a refusal, an in-band
// error or a network failure stops it, with that org's card saying why.

import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { useScanStream } from "@/components/org/shared/useScanStream";
import { startQueueFollow } from "@/components/org/shared/queueFollow";
import { emptyRoster, foldQueueSnapshot, foldStreamFrame, retryScope, type ScanRunRoster } from "@/components/org/shared/scanRunRosterModel";
import type { Installation } from "./FleetMap.constants";
import { applyScanEvent } from "./applyScanEvent";
import { type FleetQueued, type FleetScanOutcome, fleetScanOutcome, refusedOutcome } from "./fleetScanOutcomeModel";
import { type Constellation, mapRepos } from "./fleetMapStars";
import { type ScopePlan, scanDisabledFor } from "./fleetScopeModel";
import { mergeStars } from "./mergeStars";

interface FleetRun {
  roster: ScanRunRoster;
  inBandError: string | null;
  queued: FleetQueued | null;
  /** The route refused before opening the stream (non-2xx, or no body). */
  refused?: { error: string | null; status: number; code?: string };
}

/** A scoped scan (a retry of named failures); omitted = the org's whole watchlist. */
export type FleetScanScope = { repos?: string[] };

/** How one scan ended, for the plan runner: anything but "ok" stops a plan. */
type ScanEnd = "ok" | "stopped" | "busy";

const NETWORK_ERROR = "Network error: scan didn't run. Try again.";

export function useFleetScan(installations: Installation[], setConstellations: Dispatch<SetStateAction<Constellation[]>>) {
  const startScan = useScanStream();
  const [scanning, setScanning] = useState<string | null>(null);
  // Network failures only (the transport threw). Every stream end and refusal is an outcome below.
  const [scanError, setScanError] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<Record<string, FleetRun>>({});
  const scanCtrl = useRef<AbortController | null>(null);
  const scanGen = useRef(0);
  const recentScan = useRef<Map<string, number>>(new Map());
  const scanningRef = useRef<string | null>(null);
  const follows = useRef<Map<string, () => void>>(new Map());
  const alive = useRef(true);
  const planRef = useRef<{ cancelled: boolean } | null>(null);
  const [plan, setPlan] = useState<{ cancelling: boolean } | null>(null);

  useEffect(() => {
    alive.current = true;
    const followMap = follows.current;
    return () => {
      alive.current = false;
      scanCtrl.current?.abort();
      followMap.forEach((stop) => stop());
      followMap.clear();
    };
  }, []);

  const putRun = (login: string, run: FleetRun) => setRuns((rs) => ({ ...rs, [login]: run }));
  const stopFollow = (login: string) => {
    follows.current.get(login)?.();
    follows.current.delete(login);
  };

  /** One authoritative /api/app/repos pull for a drained org, merged in place (mergeStars). */
  async function pullOrg(login: string) {
    const inst = installations.find((i) => i.login === login);
    if (!inst) return;
    try {
      const qs = new URLSearchParams({ org: inst.login, installation_id: String(inst.id) });
      const r = await fetch(`/api/app/repos?${qs.toString()}`);
      const data = (await r.json().catch(() => null)) as { repos?: unknown } | null;
      if (!alive.current || !r.ok || !Array.isArray(data?.repos) || scanningRef.current === login) return;
      const fresh = mapRepos(data.repos);
      setConstellations((cur) => cur.map((c) => (c.login === login && c.status === "done" ? { ...c, repos: mergeStars(c.repos, fresh) } : c)));
    } catch {
      /* the 90s refresh reconciles it */
    }
  }

  function followQueue(login: string, runId: string) {
    stopFollow(login);
    const read = async (): Promise<"more" | "stop"> => {
      try {
        const res = await fetch(`/api/org/scan/queue?org=${encodeURIComponent(login)}&runId=${encodeURIComponent(runId)}`);
        if (!res.ok || !alive.current) return "more"; // a failed poll is not evidence the work vanished
        const d = (await res.json()) as { pending?: number; repos?: unknown };
        const pending = Number(d.pending);
        if (!alive.current || !Number.isFinite(pending)) return "more";
        setRuns((rs) => {
          const run = rs[login];
          if (!run?.queued || run.queued.runId !== runId) return rs;
          return { ...rs, [login]: { ...run, roster: foldQueueSnapshot(run.roster, d), queued: { ...run.queued, pending } } };
        });
        if (pending === 0) {
          follows.current.delete(login);
          recentScan.current.delete(login); // the remainder is in: no settle window to wait out
          void pullOrg(login);
          return "stop";
        }
      } catch {
        /* blip: keep the last known count */
      }
      return "more";
    };
    const onCeiling = () =>
      setRuns((rs) => {
        const run = rs[login];
        return run?.queued?.runId === runId ? { ...rs, [login]: { ...run, queued: { ...run.queued, stopped: true } } } : rs;
      });
    follows.current.set(login, startQueueFollow({ read, onCeiling, immediate: false }));
  }

  /** The per-org Scan (and Retry): a no-op while a plan holds the lock. */
  async function scan(login: string, scope?: FleetScanScope) {
    if (planRef.current) return;
    await scanOrg(login, scope);
  }

  async function scanOrg(login: string, scope?: FleetScanScope): Promise<ScanEnd> {
    if (scanningRef.current) return "busy";
    let end: ScanEnd = "ok";
    scanningRef.current = login;
    setScanning(login);
    setScanError((e) => {
      if (!e[login]) return e;
      const next = { ...e };
      delete next[login];
      return next;
    });
    stopFollow(login);
    scanGen.current += 1; // a concurrent auto-refresh discards its stale result
    const ctrl = new AbortController();
    scanCtrl.current = ctrl;
    const live = () => alive.current && !ctrl.signal.aborted;
    // Accumulated OUTSIDE any state updater (updaters can re-run under StrictMode), then committed.
    let run: FleetRun = { roster: emptyRoster(scope?.repos), inBandError: null, queued: null };
    putRun(login, run);
    await startScan({
      body: { org: login, ...scope },
      signal: ctrl.signal,
      onRefused: (d, status) => {
        if (!live()) return;
        const error = status >= 200 && status < 300 ? "Scan failed to start." : (d?.error ?? null);
        end = "stopped";
        putRun(login, { ...run, refused: { error, status, code: d?.code } });
      },
      onMessage: (msg) => {
        if (!live()) return;
        setConstellations((cur) => applyScanEvent(cur, login, msg));
        const { event, data } = msg;
        if (!event || !data) return;
        if (event === "error") {
          end = "stopped";
          run = { ...run, inBandError: String(data.error ?? "Scan failed.") };
        }
        else if (event === "queued") {
          const runId = String(data.runId ?? "");
          const pending = Number(data.queued);
          const total = Number(data.total);
          if (runId) run = { ...run, queued: { runId, pending: Number.isFinite(pending) ? pending : 0, total: Number.isFinite(total) ? total : 0 } };
        } else run = { ...run, roster: foldStreamFrame(run.roster, event, data) };
        putRun(login, run);
      },
      onStreamEnd: () => {
        if (!live()) return;
        recentScan.current.set(login, Date.now());
        if (run.queued && run.queued.pending > 0) followQueue(login, run.queued.runId);
      },
      onNetworkError: () => {
        end = "stopped";
        if (live()) setScanError((m) => ({ ...m, [login]: NETWORK_ERROR }));
      },
      onSettled: () => {
        if (scanCtrl.current === ctrl) scanCtrl.current = null;
        if (!alive.current) return;
        if (scanningRef.current === login) scanningRef.current = null;
        setScanning((s) => (s === login ? null : s));
      },
    });
    return ctrl.signal.aborted ? "stopped" : end;
  }

  /** Run a scoped plan one org at a time. Synchronously claims the lock, so a double click starts one. */
  async function runPlan(p: ScopePlan) {
    if (planRef.current || scanningRef.current) return;
    const token = { cancelled: false };
    planRef.current = token;
    setPlan({ cancelling: false });
    try {
      for (const r of p.runs) {
        if (token.cancelled || !alive.current) break;
        if (r.repos.length === 0) continue; // an empty scope widens to the whole watchlist server-side
        if ((await scanOrg(r.org, { repos: r.repos })) !== "ok") break;
      }
    } finally {
      if (planRef.current === token) planRef.current = null;
      if (alive.current) setPlan(null);
    }
  }

  /** Stop the plan before its next org; the org in flight finishes and reports as usual. */
  function cancelPlan() {
    if (!planRef.current) return;
    planRef.current.cancelled = true;
    setPlan({ cancelling: true });
  }

  /** Re-scan exactly the last run's failures through the ordinary scoped POST (same credit rules). */
  async function retryFailed(login: string) {
    const run = runs[login];
    if (!run) return;
    const { repos } = retryScope(run.roster);
    if (repos.length) await scan(login, { repos });
  }

  const outcomes = useMemo(() => {
    const out: Record<string, FleetScanOutcome> = {};
    for (const [login, run] of Object.entries(runs)) {
      if (login === scanning) continue; // mid-stream there is no answer yet; the button says "Scanning..."
      out[login] = run.refused
        ? refusedOutcome(run.refused.error, run.refused.status, run.refused.code)
        : fleetScanOutcome(login, run.roster, run.inBandError, run.queued);
    }
    return out;
  }, [runs, scanning]);

  const planActive = plan !== null;
  return {
    scanning, scanError, outcomes, scan, retryFailed, scanCtrl, scanGen, recentScan,
    runPlan, cancelPlan, planActive, planCancelling: plan?.cancelling ?? false,
    scanDisabledFor: (login: string) => scanDisabledFor(login, scanning, planActive),
  };
}
