"use client";

// The cockpit's DRIVE state machine — the layer above useLoopRun. It owns one drive at a time (the
// server allows exactly one per org) and the actions there are: start, stop, resume, and — for the
// standing runner — lift one repo's pause.
//
// POLL DISCIPLINE, the same contract as useLoopRun: no idle timer. The poll is a `setTimeout` CHAIN
// (`usePollChain`), armed only while a drive is live AND the tab is foregrounded (`useIsVisible`), and
// every read — the chain's and the one an action asks for — goes through one serial ticker, so a slow
// status read delays the next rather than racing it. It ticks four times slower than the loop's poll:
// a drive spends MINUTES between measurements, and the per-second detail is the running lane, which
// useLoopRun already fetches. A STANDING RUNNER is live while `paused` or `idle` too (`isDriveLive`) —
// it is waiting, not over — so the poll keeps running through a pause and sees it lift.
//
// GATING. `enabled` is the cockpit's own can-run predicate (self-hosted + autopilot + owner + paired).
// When it is false there is no mount tick at all: on managed cloud the route 404s by design, and a
// panel that has never been offered has no business asking.
//
// SETTLEMENT. A drive stops being live by acquiring an `endedAt`, not by disappearing (the registry
// keeps it for the rest of the process), so the transition is detected on the status itself and the
// final DriveStatus — the one carrying the terminal phase — is handed up exactly once.

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsVisible } from "../useIsVisible";
import { fetchDriveStatus, resumeDrive, resumeRunnerRepo, startDrive, stopDrive, type StartDriveInput } from "./driveClient";
import { isDriveLive, type DriveStatus } from "./driveTypes";
import { usePollChain } from "./usePollChain";

const POLL_MS = 12_000;

export interface UseDriveInput {
  slug: string;
  /** The cockpit's can-run gate. False ⇒ no polling, no requests, no panel. */
  enabled: boolean;
  /** Fired once, with the terminal status, when the drive reaches green/dry/ceiling/stopped/error. */
  onSettled?: (drive: DriveStatus) => void;
}

const isLive = (d: DriveStatus | null | undefined): boolean => d != null && d.endedAt == null && isDriveLive(d.phase);

export function useDrive({ slug, enabled, onSettled }: UseDriveInput) {
  const [drive, setDrive] = useState<DriveStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const live = isLive(drive);
  const visible = useIsVisible();

  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);
  // The id we last saw live — the thing whose termination means "it finished".
  const lastLiveId = useRef<string | null>(null);

  const adopt = useCallback((next: DriveStatus | null) => {
    setDrive(next);
    if (next && isLive(next)) {
      lastLiveId.current = next.id;
    } else if (next && lastLiveId.current === next.id) {
      lastLiveId.current = null;
      settledRef.current?.(next);
    }
  }, []);

  const read = useCallback(async () => {
    try {
      const status = await fetchDriveStatus(slug);
      // listDrives is newest-first; a live one always wins, else keep tracking the one we know.
      const running = status.drives.find(isLive) ?? null;
      const tracked = lastLiveId.current ? status.drives.find((d) => d.id === lastLiveId.current) ?? null : null;
      adopt(running ?? tracked ?? status.drives[0] ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    }
  }, [slug, adopt]);

  // The chain runs only while a drive is live and the tab is foregrounded; `null` arms nothing.
  const ticker = usePollChain(read, enabled && live && visible ? POLL_MS : null);
  const tick = ticker.run;

  // One read on mount (it catches a drive started by curl or in another tab) — scheduled from a
  // callback, so the effect itself never sets state synchronously.
  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => void tick(), 0);
    return () => clearTimeout(first);
  }, [enabled, tick]);

  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const start = useCallback(
    async (input: StartDriveInput) => {
      const res = await guard(() => startDrive(slug, input));
      if (res?.drive) adopt(res.drive);
      return res?.drive ?? null;
    },
    [guard, slug, adopt],
  );

  const stop = useCallback(async () => {
    const id = drive?.id;
    if (!id) return;
    await guard(() => stopDrive(slug, id));
    void tick();
  }, [guard, slug, drive?.id, tick]);

  // Resume returns a NEW drive continuing the interrupted one's chain, so what is adopted is the
  // response — never the id that was asked about, which stays interrupted as the record of that
  // segment.
  const resume = useCallback(
    async (id: string) => {
      const res = await guard(() => resumeDrive(slug, id));
      if (res?.drive) adopt(res.drive);
      return res?.drive ?? null;
    },
    [guard, slug, adopt],
  );

  // Lift one repo's pause on the live runner; the response is the runner with that repo working again.
  const resumeRepo = useCallback(
    async (repo: string) => {
      const res = await guard(() => resumeRunnerRepo(slug, repo));
      if (res?.drive) adopt(res.drive);
      return res?.drive ?? null;
    },
    [guard, slug, adopt],
  );

  return { drive, live, error, busy, start, stop, resume, resumeRepo, refresh: tick };
}
