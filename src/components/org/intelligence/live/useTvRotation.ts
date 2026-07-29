// TV-mode stage rotation: auto-advance, the four pause sources (hover/focus/manual/tab-hidden), and
// the Esc/arrow/Space keyboard handling. Pulled out of LiveWarRoomTv.tsx to stay under the 200-LOC cap
// (docs/ORG-TABS-REFACTOR.md) — owns no JSX.

import { useCallback, useEffect, useState } from "react";
import { clampStageIndex } from "./liveTvStages";

const STAGE_MS = 14_000;

export function useTvRotation(stagesLength: number, onExit: () => void) {
  const [idx, setIdx] = useState(0);
  // Pause sources (live-war-room 07-16 #5 / WCAG 2.2.2 Pause-Stop-Hide): hover was the ONLY way to
  // hold a stage, which excludes keyboard-only presenters and remotes. Rotation now also pauses on
  // focus within the wall and via an explicit toggle (button / Space), so any input can hold a stage.
  const [hoverPaused, setHoverPaused] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const [manualPaused, setManualPaused] = useState(false);
  const paused = hoverPaused || focusPaused || manualPaused;
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setVisible(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // Auto-rotate through the relevant stages; a single-stage state (or a running scan) never rotates.
  useEffect(() => {
    if (stagesLength <= 1 || paused || !visible) return;
    const t = setInterval(() => setIdx((i) => i + 1), STAGE_MS);
    return () => clearInterval(t);
  }, [stagesLength, paused, visible]);

  // Esc exits TV mode; leaving fullscreen (also Esc) exits too, so the two stay in lockstep.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Space toggles the rotation pause — but never when it would activate a focused control.
      const onControl =
        e.target instanceof HTMLElement && /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(e.target.tagName);
      if (e.key === "Escape") onExit();
      else if (e.key === "ArrowRight") setIdx((i) => i + 1);
      else if (e.key === "ArrowLeft") setIdx((i) => i - 1);
      else if (e.key === " " && !onControl) {
        e.preventDefault(); // don't page-scroll the wall
        setManualPaused((p) => !p);
      }
    };
    const onFs = () => {
      if (typeof document !== "undefined" && !document.fullscreenElement) onExit();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [onExit]);

  const activeIdx = clampStageIndex(idx, stagesLength);

  const onMouseEnter = useCallback(() => setHoverPaused(true), []);
  const onMouseLeave = useCallback(() => setHoverPaused(false), []);
  const onFocus = useCallback(() => setFocusPaused(true), []);
  const onBlur = useCallback((e: React.FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusPaused(false);
  }, []);

  return { idx, setIdx, activeIdx, manualPaused, setManualPaused, onMouseEnter, onMouseLeave, onFocus, onBlur };
}
