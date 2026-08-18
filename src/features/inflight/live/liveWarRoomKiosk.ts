"use client";

// The read-only kiosk lane of the war room (war-room #1), split out of useLiveWarRoom.ts for the
// 200-LOC src/features cap. A TV/shared wall has no SSE stream, so this polls the server component
// and reconciles the refreshed seed back into state; tab visibility gates the poll so a backgrounded
// wall doesn't hammer the route.

import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import type { LiveRepo, LiveRepoSeed } from "@/components/org/shared/liveWarRoomShared";

export function useLiveWarRoomKiosk({
  readOnly,
  seed,
  reposRef,
  setRepos,
}: {
  readOnly: boolean;
  seed: LiveRepoSeed[];
  reposRef: RefObject<Record<string, LiveRepo>>;
  setRepos: Dispatch<SetStateAction<Record<string, LiveRepo>>>;
}) {
  const router = useRouter();
  // Page Visibility: true while the tab is foregrounded. Gates the read-only kiosk poll so a
  // backgrounded/idle wall doesn't hammer the refresh route. Default true for SSR; corrected on
  // mount + every visibilitychange.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setVisible(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // war-room #1: the read-only TV/shared wall has no SSE stream (readOnly suppresses launch()), so
  // without this it's a frozen page-load snapshot. Poll the server component (force-dynamic → re-reads
  // the org rollup) via router.refresh() so the kiosk view actually updates over time. Authenticated
  // walls keep their live SSE path and don't poll. Skip while the tab is hidden so a backgrounded TV
  // doesn't hammer the route, and resume on focus (the effect re-runs when `visible` flips).
  const REFRESH_MS = 60 * 1000;
  useEffect(() => {
    if (!readOnly || !visible) return;
    const t = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [readOnly, visible, router, REFRESH_MS]);

  // In readOnly mode, router.refresh() re-renders the server component with a fresh `seed`, but `repos`
  // was seeded once at mount — reconcile new server seed into state so the refreshed rollup shows.
  // Only in readOnly: on an authenticated wall the SSE fold owns `repos` and must not be clobbered.
  useEffect(() => {
    if (!readOnly) return;
    const next = Object.fromEntries(seed.map((r) => [r.fullName, { ...r, updatedAt: 0 }]));
    reposRef.current = next;
    setRepos(next);
  }, [readOnly, seed, reposRef, setRepos]);
}
