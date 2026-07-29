"use client";

// Client state for the war-room SHIP LOOP band: holds the OpsState the server seeded, advances it
// with a visibility-gated monitor poll (POST refresh → PR states + verify pass), and exposes the
// triage actions. Poll cadence is slow (PRs merge on human timescales) and stops entirely while
// the tab is hidden — the same "a backgrounded wall must not burn resources" rule as the scan loop.

import { useCallback, useEffect, useRef, useState } from "react";
import type { OpsState } from "@/lib/db";

const REFRESH_MS = 90_000;

export function useShipLoop({
  slug,
  initial,
  onMerged,
}: {
  slug: string;
  initial: OpsState | null;
  /** Fired with the repos whose PRs JUST merged this tick — the wall's cue to verify-rescan. */
  onMerged?: (fullNames: string[]) => void;
}) {
  const [state, setState] = useState<OpsState | null>(initial);
  const [busy, setBusy] = useState<Record<string, "accept" | "reject">>({});
  const [error, setError] = useState<string | null>(null);
  const [polledAt, setPolledAt] = useState<number | null>(null);

  // Latest onMerged without re-arming the poll effect.
  const onMergedRef = useRef(onMerged);
  useEffect(() => {
    onMergedRef.current = onMerged;
  }, [onMerged]);

  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setVisible(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/org/ops", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, action: "refresh" }),
      });
      const d = (await res.json().catch(() => null)) as { state?: OpsState; newlyMerged?: string[]; error?: string } | null;
      if (!res.ok) {
        setError(d?.error ?? `Monitor tick failed (${res.status}).`);
        return;
      }
      setError(null);
      if (d?.state) setState(d.state);
      setPolledAt(Date.now());
      if (d?.newlyMerged?.length) onMergedRef.current?.(d.newlyMerged);
    } catch {
      setError("Network error while polling PR status.");
    }
  }, [slug]);

  // Monitor loop: one tick shortly after mount (catch transitions since the SSR snapshot — a wall
  // left on overnight reloads rarely), then every REFRESH_MS while foregrounded.
  useEffect(() => {
    if (!visible) return;
    const first = setTimeout(() => void refresh(), 4_000);
    const t = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [visible, refresh]);

  const act = useCallback(
    async (action: "accept" | "reject", id: string) => {
      setBusy((b) => ({ ...b, [id]: action }));
      setError(null);
      try {
        const res = await fetch("/api/org/ops", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ org: slug, action, id }),
        });
        const d = (await res.json().catch(() => null)) as { state?: OpsState; error?: string } | null;
        if (!res.ok) {
          setError(d?.error ?? `${action === "accept" ? "Opening the PR" : "Dismissing"} failed (${res.status}).`);
          return;
        }
        if (d?.state) setState(d.state);
      } catch {
        setError("Network error.");
      } finally {
        setBusy((b) => {
          const next = { ...b };
          delete next[id];
          return next;
        });
      }
    },
    [slug],
  );

  const accept = useCallback((id: string) => act("accept", id), [act]);
  const reject = useCallback((id: string) => act("reject", id), [act]);

  return { state, busy, error, polledAt, accept, reject, refresh };
}
