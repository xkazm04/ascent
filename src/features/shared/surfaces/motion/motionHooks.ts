"use client";

// The scene's mechanics as hooks: the one-shot seen-set, the merged pause signal, and elapsed-time
// cadence. Each is the technique it embodies, kept small enough to be read whole in the drawer.
// Written against the React Compiler rules: no ref is read during render, no setState runs
// synchronously in an effect body, and no clock is read during render — `now` is state advanced by
// an interval, and prop-driven transitions use the adjust-state-during-render form.

import { useCallback, useEffect, useState, type RefObject } from "react";
import { BUDGET } from "./presets";

/**
 * One-shot guarding. A SURFACE-scoped set of identities that have already entered, consulted during
 * render (`enters(id)`, so an item's very first frame is decided: enter animated, or appear settled)
 * and written by the entrance itself — `mark(id)` from the row's `onAnimationEnd`, which the 1ms
 * reduced epsilon still fires. `scope` is the question's identity: a change resets the set; a poll
 * re-delivering known ids never does.
 */
export function useSeenSet(scope: string) {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const [prevScope, setPrevScope] = useState(scope);
  if (prevScope !== scope) {
    setPrevScope(scope);
    setSeen(new Set()); // the ONE reset policy, applied in one place
  }
  const enters = useCallback((id: string): boolean => !seen.has(id), [seen]);
  const mark = useCallback((id: string) => setSeen((s) => (s.has(id) ? s : new Set(s).add(id))), []);
  return { enters, mark, size: seen.size };
}

export type Decider = "reduced" | "in-view" | "foregrounded" | "user-stop" | "hover (timed)";

/**
 * Loop-pause governance: a CLOSED set of deciders merged into one answer every loop reads. A decider
 * is a veto; the merge is a disjunction. `in-view` abstains where IntersectionObserver is absent
 * (the partial-merge fallback: preference and foreground keep vetoing, the coordinator-scoped ones
 * default to no objection). The hover pause is TIMED — a tap on a touch surface fires the entering
 * half and never the leaving half, so it expires on its own rather than wedging the loop. The user
 * stop is one-directional: `stop()` sets it, only the labelled `resume()` clears it.
 */
export function usePauseAuthorities(reduced: boolean, ref: RefObject<HTMLElement | null>, hoverPauseMs = 3000) {
  const [inView, setInView] = useState(true);
  const [foregrounded, setForegrounded] = useState(true);
  const [userStop, setUserStop] = useState(false);
  const [hoverUntil, setHoverUntil] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.forEach((e) => setInView(e.isIntersecting)), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  useEffect(() => {
    const sync = () => setForegrounded(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  // While a hover pause is armed, tick `now` so the countdown reads and the pause lifts on time.
  useEffect(() => {
    if (!hoverUntil) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [hoverUntil]);

  const hoverPaused = hoverUntil > 0 && hoverUntil > now;
  const vetoes: Decider[] = [];
  if (reduced) vetoes.push("reduced");
  if (!inView) vetoes.push("in-view");
  if (!foregrounded) vetoes.push("foregrounded");
  if (userStop) vetoes.push("user-stop");
  if (hoverPaused) vetoes.push("hover (timed)");

  return {
    paused: vetoes.length > 0,
    vetoes,
    userStop,
    hoverPaused,
    hoverRemainingMs: hoverPaused ? hoverUntil - now : 0,
    stop: () => setUserStop(true),
    resume: () => setUserStop(false),
    armHover: () => {
      const t = Date.now();
      setNow(t);
      setHoverUntil(t + hoverPauseMs);
    },
  };
}

/**
 * Cadence from elapsed time, not counted ticks: the current step of an auto-advancing loop is
 * derived from the wall clock since start, minus time spent paused (banked). Two mounts compute
 * the same step instead of advancing twice; a user resume (`restart`) begins the interval anew.
 */
export function useElapsedStep(count: number, intervalMs: number, paused: boolean) {
  const [now, setNow] = useState(() => Date.now());
  const [start, setStart] = useState(now);
  const [banked, setBanked] = useState(0);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [prevPaused, setPrevPaused] = useState(paused);
  if (prevPaused !== paused) {
    setPrevPaused(paused);
    if (paused) setPausedAt(now);
    else if (pausedAt !== null) {
      setBanked((b) => b + (now - pausedAt)); // bank the remainder across a machine pause
      setPausedAt(null);
    }
  }
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [paused]);
  const elapsed = Math.max(0, (pausedAt ?? now) - start - banked);
  const step = count > 0 ? Math.floor(elapsed / intervalMs) % count : 0;
  const restart = () => {
    const t = Date.now();
    setNow(t);
    setStart(t);
    setBanked(0);
    setPausedAt(null);
  };
  return { step, elapsedMs: elapsed, restart, owesControl: elapsed > BUDGET.visibleControlAfterMs };
}
