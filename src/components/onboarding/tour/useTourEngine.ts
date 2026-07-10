"use client";

// The tour engine behind the guided checklist drawer. It owns the presentation-independent parts: the
// step cursor, cross-page redirection, and resolving + tracking the on-page anchor rect. Because the host
// lives in the ORG LAYOUT (which persists across sub-page navigation), the engine survives a redirect and
// re-resolves the anchor once the new page mounts.
//
// `enabled` mirrors whether the drawer is open. While collapsed the engine keeps its cursor but does
// nothing observable — no forced navigation, no highlight, no Escape capture — so a hidden tour never
// yanks the page around; reopening resumes the current step and re-activates the highlight.

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { TourStep } from "./types";

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
  const [index, setIndex] = useState(0);
  // The measured anchor is tagged with the step it belongs to; `rect` is then derived to null the instant
  // the cursor moves, so a stale rect can't linger on screen during a cross-page redirect.
  const [anchored, setAnchored] = useState<{ stepId: string; rect: DOMRect } | null>(null);
  const step = steps[index] ?? null;

  const hrefFor = useCallback((s: TourStep) => (s.page ? `/org/${slug}/${s.page}` : `/org/${slug}`), [slug]);
  const onPage = !step || pathname === hrefFor(step);

  // Redirect to the step's page when it differs (only while open). Pure side effect — the layout-mounted
  // host persists the engine across this navigation, so advancing the cursor is all it takes to move pages.
  useEffect(() => {
    if (enabled && step && pathname !== hrefFor(step)) router.push(hrefFor(step));
  }, [enabled, step, pathname, hrefFor, router]);

  // Measure + track the anchor rect. Every setState here fires inside an rAF or an event callback (never
  // synchronously in the effect body), so it reads as DOM→React synchronization rather than a render
  // cascade. After a redirect the target mounts a beat late, so poll on rAF (bounded) until it appears.
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
      } else if (tries++ < 120) {
        raf = requestAnimationFrame(settle);
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
  const next = useCallback(() => setIndex((i) => clamp(i + 1)), [clamp]);
  const prev = useCallback(() => setIndex((i) => clamp(i - 1)), [clamp]);
  const goTo = useCallback((i: number) => setIndex(clamp(i)), [clamp]);

  const rect = enabled && step && anchored?.stepId === step.id ? anchored.rect : null;
  const seeking = enabled && !!step && (!onPage || (step.anchor != null && rect == null));

  return {
    step,
    index,
    total: steps.length,
    rect,
    seeking,
    atFirst: index === 0,
    atLast: index === steps.length - 1,
    next,
    prev,
    goTo,
    exit: onExit,
  };
}
