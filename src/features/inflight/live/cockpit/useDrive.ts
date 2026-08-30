"use client";

// The cockpit's DRIVE state machine — the layer above useLoopRun. It owns one drive at a time (the
// server allows exactly one per org) and the two actions there are: start, stop.
//
// POLL DISCIPLINE, the same contract as useLoopRun and useShipLoop: no idle timer. A tick is armed
// only while a drive is actually live AND the tab is foregrounded. It costs one more request than the
// loop's poll, but a drive spends MINUTES between measurements, so it ticks four times slower — the
// interesting per-second detail during a drive is the running lane, and useLoopRun is already
// fetching that.
//
// GATING. `enabled` is the cockpit's own can-run predicate (self-hosted + autopilot + owner + paired).
// When it is false there is no mount tick at all: on managed cloud the route 404s by design, and a
// panel that has never been offered has no business asking.
//
// SETTLEMENT. A drive stops being live by acquiring an `endedAt`, not by disappearing (the registry
// keeps it for the rest of the process), so the transition is detected on the status itself and the
// final DriveStatus — the one carrying the terminal phase — is handed up exactly once.

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDriveStatus, resumeDrive, startDrive, stopDrive, type StartDriveInput } from "./driveClient";
import { isDriveLive, type DriveStatus } from "./driveTypes";

const POLL_MS = 12_000;

export interface UseDriveInput {
  slug: string;
  /** The cockpit's can-run gate. False ⇒ no polling, no requests, no panel. */
  enabled: boolean;
  /** Fired once, with the terminal status, when the drive reaches green/dry/ceiling/stopped/error. */
  onSettled?: (drive: DriveStatus) => void;
}

export function useDrive({ slug, enabled, onSettled }: UseDriveInput) {
  const [drive, setDrive] = useState<DriveStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const live = drive != null && drive.endedAt == null && isDriveLive(drive.phase);

  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);
  // The id we last saw live — the thing whose termination means "it finished".
  const lastLiveId = useRef<string | null>(null);

  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setVisible(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const adopt = useCallback((next: DriveStatus | null) => {
    setDrive(next);
    if (next && next.endedAt == null && isDriveLive(next.phase)) {
      lastLiveId.current = next.id;
    } else if (next && lastLiveId.current === next.id) {
      lastLiveId.current = null;
      settledRef.current?.(next);
    }
  }, []);

  const tick = useCallback(async () => {
    try {
      const status = await fetchDriveStatus(slug);
      // listDrives is newest-first; a live one always wins, else keep tracking the one we know.
      const running = status.drives.find((d) => d.endedAt == null && isDriveLive(d.phase)) ?? null;
      const tracked = lastLiveId.current ? status.drives.find((d) => d.id === lastLiveId.current) ?? null : null;
      adopt(running ?? tracked ?? status.drives[0] ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    }
  }, [slug, adopt]);

  // One tick on mount (it catches a drive started by curl or in another tab), then an interval ONLY
  // while one is live and the tab is foregrounded. Both are scheduled from callbacks, so the effect
  // itself never sets state synchronously.
  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => void tick(), 0);
    const t = live && visible ? setInterval(() => void tick(), POLL_MS) : null;
    return () => {
      clearTimeout(first);
      if (t) clearInterval(t);
    };
  }, [enabled, live, visible, tick]);

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

  return { drive, live, error, busy, start, stop, resume, refresh: tick };
}
