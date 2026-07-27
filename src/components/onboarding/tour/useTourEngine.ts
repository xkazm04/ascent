"use client";

// The tour engine behind the guided checklist drawer. It owns the presentation-independent parts: the
// step cursor, cross-page redirection, resolving + tracking the on-page anchor rect, session persistence,
// and skipping steps whose anchor doesn't exist on THIS org's dashboard. Because the host lives in the
// ORG LAYOUT (which persists across sub-page navigation), the engine survives a redirect and re-resolves
// the anchor once the new page mounts.
//
// `enabled` mirrors whether the drawer is open. While collapsed the engine keeps its cursor but does
// nothing observable — no forced navigation, no highlight, no Escape capture — so a hidden tour never
// yanks the page around; reopening resumes the current step and re-activates the highlight.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { TourStep } from "./types";
import { readTourState, writeTourState } from "./tourStorage";

/** rAF frames the engine waits for a step's anchor to mount before declaring it absent (~2s at 60fps).
 *  Generous, because a cross-page step must survive the destination page's data fetch + render. */
export const ANCHOR_POLL_FRAMES = 120;

export interface TourEngine {
  step: TourStep | null;
  index: number;
  total: number;
  /** Viewport rect of the CURRENT step's anchor (null for a concept step, or until it resolves). Keyed
   *  to the step id, so a redirect never briefly highlights the previous step's element. */
  rect: DOMRect | null;
  /** True while redirecting to the step's page / waiting for its anchor element to mount. */
  seeking: boolean;
  atFirst: boolean;
  atLast: boolean;
  /** Steps whose anchor never materialized on this org (see the skip note below) — the presentation
   *  layer marks them unavailable instead of offering a step that can only point at nothing. */
  isSkipped: (stepId: string) => boolean;
  next: () => void;
  prev: () => void;
  goTo: (i: number) => void;
  exit: () => void;
}

export function useTourEngine(
  slug: string,
  steps: TourStep[],
  { enabled, onExit }: { enabled: boolean; onExit: () => void },
): TourEngine {
  const router = useRouter();
  const pathname = usePathname();
  // The cursor starts at 0 and is RESTORED after mount, never seeded lazily: this hook renders inside a
  // server-rendered org layout, so a lazy initializer reading sessionStorage would make the client's first
  // render disagree with the SSR'd markup (the "3/6" counter) — a hydration mismatch.
  const [index, setIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  // The measured anchor is tagged with the step it belongs to; `rect` is then derived to null the instant
  // the cursor moves, so a stale rect can't linger on screen during a cross-page redirect.
  const [anchored, setAnchored] = useState<{ stepId: string; rect: DOMRect } | null>(null);
  // Steps whose anchor never appeared. The step list was authored against the CURATED DEMO org and the
  // tour now runs on every org dashboard — where some anchors genuinely don't exist: `scan-scope` renders
  // only for non-personal orgs, and `results-view`/`results-controls` only once the org has scans in the
  // active window (the overview short-circuits to an empty state before them). Rather than parking the
  // drawer on a permanent "seeking…" spinner aimed at nothing, the engine records the miss and moves on.
  const [skipped, setSkipped] = useState<Record<string, true>>({});
  // Direction of travel, so a skipped step is stepped OVER the way the user was already going. We never
  // reverse: if nothing is live ahead the cursor stays put and the step reads as unavailable — auto-
  // reversing would bounce the user between the last live step and the dead one on every "Next".
  const dirRef = useRef<1 | -1>(1);
  const step = steps[index] ?? null;

  const hrefFor = useCallback((s: TourStep) => (s.page ? `/org/${slug}/${s.page}` : `/org/${slug}`), [slug]);
  const onPage = !step || pathname === hrefFor(step);

  // Restore the saved cursor once, on mount (see the hydration note above). Declared BEFORE the persist
  // effect so the read always beats the first write.
  useEffect(() => {
    const saved = readTourState(slug);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot restore of the persisted cursor
    if (saved) setIndex(Math.max(0, Math.min(steps.length - 1, saved.index)));
    setHydrated(true); // arms the persist effect, now that the read is done
    // Mount-only restore for this org; `steps` is a module constant and re-clamping on a step-list change
    // would fight the live cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Persist open-state + cursor for this org, so a hard refresh mid-tour resumes exactly where it was
  // instead of silently rewinding to step 1 with the drawer shut. Gated on `hydrated` so the pre-restore
  // render can't overwrite the very record it's about to read. Best-effort (see tourStorage).
  useEffect(() => {
    if (!hydrated) return;
    writeTourState(slug, { open: enabled, index });
  }, [hydrated, slug, enabled, index]);

  // Redirect to the step's page when it differs (only while open). Pure side effect — the layout-mounted
  // host persists the engine across this navigation, so advancing the cursor is all it takes to move pages.
  useEffect(() => {
    if (enabled && step && pathname !== hrefFor(step)) router.push(hrefFor(step));
  }, [enabled, step, pathname, hrefFor, router]);

  // Measure + track the anchor rect. Every setState here fires inside an rAF or an event callback (never
  // synchronously in the effect body), so it reads as DOM→React synchronization rather than a render
  // cascade. After a redirect the target mounts a beat late, so poll on rAF (bounded) until it appears —
  // and when that budget runs out, mark the step skipped instead of polling for a target that never comes.
  useEffect(() => {
    if (!enabled || !step || pathname !== hrefFor(step) || !step.anchor) return;
    const { id: stepId, anchor } = step;
    const find = () => document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
    let raf = 0;
    let tries = 0;
    const settle = () => {
      const el = find();
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setAnchored({ stepId, rect: el.getBoundingClientRect() });
      } else if (tries++ < ANCHOR_POLL_FRAMES) {
        raf = requestAnimationFrame(settle);
      } else {
        setSkipped((cur) => (cur[stepId] ? cur : { ...cur, [stepId]: true }));
      }
    };
    raf = requestAnimationFrame(settle);
    const track = () => {
      const el = find();
      if (el) setAnchored({ stepId, rect: el.getBoundingClientRect() });
    };
    window.addEventListener("scroll", track, true);
    window.addEventListener("resize", track);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", track, true);
      window.removeEventListener("resize", track);
    };
  }, [enabled, step, pathname, hrefFor]);

  // Step over a step this org's dashboard can't anchor, continuing in the current direction of travel.
  useEffect(() => {
    if (!enabled || !step || !skipped[step.id]) return;
    const dir = dirRef.current;
    for (let i = index + dir; i >= 0 && i < steps.length; i += dir) {
      const candidate = steps[i];
      if (candidate && !skipped[candidate.id]) {
        setIndex(i);
        return;
      }
    }
    // Nothing live ahead — stay put; the drawer renders this step as unavailable rather than spinning.
  }, [enabled, step, skipped, index, steps]);

  // Escape collapses the drawer — bound only while it's open.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onExit]);

  const clamp = useCallback((i: number) => Math.max(0, Math.min(steps.length - 1, i)), [steps.length]);
  const next = useCallback(() => {
    dirRef.current = 1;
    setIndex((i) => clamp(i + 1));
  }, [clamp]);
  const prev = useCallback(() => {
    dirRef.current = -1;
    setIndex((i) => clamp(i - 1));
  }, [clamp]);
  const goTo = useCallback(
    (i: number) =>
      setIndex((cur) => {
        const target = clamp(i);
        if (target !== cur) dirRef.current = target > cur ? 1 : -1;
        return target;
      }),
    [clamp],
  );
  const isSkipped = useCallback((stepId: string) => skipped[stepId] === true, [skipped]);

  const rect = enabled && step && anchored?.stepId === step.id ? anchored.rect : null;
  const stepSkipped = !!step && skipped[step.id] === true;
  const seeking = enabled && !!step && !stepSkipped && (!onPage || (step.anchor != null && rect == null));

  return {
    step,
    index,
    total: steps.length,
    rect,
    seeking,
    atFirst: index === 0,
    atLast: index === steps.length - 1,
    isSkipped,
    next,
    prev,
    goTo,
    exit: onExit,
  };
}
