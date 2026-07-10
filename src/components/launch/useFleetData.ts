"use client";

import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect } from "react";
import { type Installation, SCAN_SETTLE_MS } from "./FleetMap.constants";
import { type Constellation, mapRepos } from "./fleetMapStars";
import { mergeStars } from "./mergeStars";

// Loads and keeps the constellation grid live: an initial per-org fetch, then a ~90s visible-tab
// refresh that patches changed stars in place. Extracted verbatim from FleetMap so the orchestrator
// stays under the 300-LOC cap; behavior (guards, races, cleanup) is unchanged.
export function useFleetData(
  installations: Installation[],
  setConstellations: Dispatch<SetStateAction<Constellation[]>>,
  scanCtrl: MutableRefObject<AbortController | null>,
  scanGen: MutableRefObject<number>,
  recentScan: MutableRefObject<Map<string, number>>,
) {
  useEffect(() => {
    const controller = new AbortController();
    for (const inst of installations) {
      const qs = new URLSearchParams({ org: inst.login, installation_id: String(inst.id) });
      fetch(`/api/app/repos?${qs.toString()}`, { signal: controller.signal })
        .then(async (r) => {
          const data = (await r.json().catch(() => null)) as { repos?: unknown; error?: string } | null;
          setConstellations((cur) =>
            cur.map((c) =>
              c.id !== inst.id
                ? c
                : r.ok
                  ? { id: inst.id, login: inst.login, status: "done", repos: mapRepos(data?.repos) }
                  : { id: inst.id, login: inst.login, status: "error", message: data?.error ?? `Failed (${r.status})` },
            ),
          );
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setConstellations((cur) =>
            cur.map((c) =>
              c.id === inst.id ? { id: inst.id, login: inst.login, status: "error", message: "Network error" } : c,
            ),
          );
        });
    }
    return () => controller.abort();
  }, [installations, setConstellations]);

  // MAP-6: keep the constellation live — re-pull each org every ~90s while the tab is VISIBLE, patching
  // changed stars in place (unchanged stars keep their identity via mergeStars, so they don't re-animate).
  // Skips a hidden tab and never fights an in-flight manual scan (the SSE stream owns the stars then).
  useEffect(() => {
    if (installations.length === 0) return;
    let cancelled = false;
    async function refreshAll() {
      if (document.visibilityState !== "visible" || scanCtrl.current) return;
      // Snapshot the scan generation BEFORE the network round-trip. The guard above only catches a scan
      // already in flight; a scan that starts (and the fetch resolves) after this point would otherwise
      // commit pre-scan rows (often overall:null) over the live scores the SSE stream just painted.
      const genAtStart = scanGen.current;
      await Promise.all(
        installations.map(async (inst) => {
          try {
            // Defer a just-scanned org until its fresh scores have propagated, so the poll can't pull
            // a stale payload and dim a star back down (MAP-6 race). Clear the marker once elapsed.
            const scannedAt = recentScan.current.get(inst.login);
            if (scannedAt != null) {
              if (Date.now() - scannedAt < SCAN_SETTLE_MS) return;
              recentScan.current.delete(inst.login);
            }
            const qs = new URLSearchParams({ org: inst.login, installation_id: String(inst.id) });
            const r = await fetch(`/api/app/repos?${qs.toString()}`);
            if (!r.ok || cancelled) return;
            const data = (await r.json().catch(() => null)) as { repos?: unknown } | null;
            const fresh = mapRepos(data?.repos);
            // Re-check the live-scan guard at COMMIT time, not just at fetch start: a manual scan that
            // began during this round-trip now owns the stars, so don't clobber its fresh scores.
            if (cancelled || scanCtrl.current || scanGen.current !== genAtStart) return;
            setConstellations((cur) =>
              cur.map((c) => (c.id === inst.id && c.status === "done" ? { ...c, repos: mergeStars(c.repos, fresh) } : c)),
            );
          } catch {
            /* leave the stars as-is on a transient blip */
          }
        }),
      );
    }
    const id = setInterval(refreshAll, 90_000);
    // Re-pull immediately when the tab regains focus so a user returning to a backgrounded Mission
    // Control doesn't stare at scores up to ~90s stale before the next tick (the interval no-ops while
    // hidden). refreshAll's own visibility/scan guards keep this safe.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshAll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable; matches FleetMap's original [installations] dep
  }, [installations]);
}
