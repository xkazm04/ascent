/**
 * Keyboard wiring for DevInspector. The listener is bound once (deps are stable
 * ref boxes) and reads live mode/hover/selection so `;` then `i` cannot miss
 * arming across a re-subscribe, and Enter / `c` / ↑↓ copy the current crumb.
 */

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { dedupeChain, formatHudCopy, stepCrumbIndex, type LocEntry } from "./devLocate";

export type InspectorMode = "off" | "nav" | "armed";

export interface InspectorKeyHover {
  chain: LocEntry[];
}

/**
 * Is this keystroke headed into an editing widget (so `;`/`i`/Enter/`c` must not
 * be swallowed)? Resolves the REAL target via composedPath() first — for a
 * shadow-DOM editor `e.target` is the host element, and the tag/contenteditable
 * checks would miss it. Covers `<select>` (its type-to-select eats keys) and
 * `closest('[contenteditable]')` for the host-element case where
 * `isContentEditable` doesn't inherit.
 * NOTE: `Escape` deliberately bypasses this guard in the handler — exiting must always work.
 */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const raw = (typeof e.composedPath === "function" ? e.composedPath()[0] : null) ?? e.target;
  const el = raw instanceof Element ? raw : null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable || el.closest("[contenteditable]") !== null;
}

export function isArmedCopyKey(key: string): boolean {
  return key === "Enter" || key === "c" || key === "C";
}

/** +1 for ↓, −1 for ↑, else not a crumb-selection key. */
export function crumbStepDelta(key: string): number | null {
  if (key === "ArrowDown") return 1;
  if (key === "ArrowUp") return -1;
  return null;
}

export function useInspectorKeys({
  modeRef,
  setMode,
  hoverRef,
  selectedRef,
  setSelectedIndex,
  doCopy,
}: {
  modeRef: MutableRefObject<InspectorMode>;
  setMode: Dispatch<SetStateAction<InspectorMode>>;
  hoverRef: MutableRefObject<InspectorKeyHover | null>;
  selectedRef: MutableRefObject<number>;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  doCopy: (loc: string) => void | Promise<void>;
}): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape is the escape hatch: it must work even with focus in an input/textarea/editor —
      // otherwise a developer armed mid-form-debugging has no keyboard way out (the exact workflow
      // the tool targets). Only the mode-entry keys (';'/'i') defer to a typing target.
      if (e.key === "Escape" && modeRef.current !== "off") {
        modeRef.current = "off";
        setMode("off");
        return;
      }
      if (isTypingTarget(e)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === ";") {
        e.preventDefault();
        // nav→off, off→nav, armed unchanged. Computed from the live ref (not the setMode updater, so the
        // reducer stays pure); the 2s auto-off is scheduled by the effect in DevInspector keyed on mode === "nav".
        const next: InspectorMode =
          modeRef.current === "armed" ? "armed" : modeRef.current === "nav" ? "off" : "nav";
        modeRef.current = next;
        setMode(next);
        return;
      }

      if ((e.key === "i" || e.key === "I") && modeRef.current === "nav") {
        e.preventDefault();
        modeRef.current = "armed";
        setMode("armed");
        return;
      }

      if (modeRef.current !== "armed") return;

      const hover = hoverRef.current;
      if (!hover) return;
      const crumbs = dedupeChain(hover.chain);
      if (crumbs.length === 0) return;

      const delta = crumbStepDelta(e.key);
      if (delta !== null) {
        e.preventDefault();
        const next = stepCrumbIndex(selectedRef.current, delta, crumbs.length);
        selectedRef.current = next;
        setSelectedIndex(next);
        return;
      }

      if (isArmedCopyKey(e.key)) {
        e.preventDefault();
        const i = Math.min(Math.max(0, selectedRef.current), crumbs.length - 1);
        const pick = crumbs[i];
        if (pick) void doCopy(formatHudCopy(pick.loc));
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [doCopy, hoverRef, modeRef, selectedRef, setMode, setSelectedIndex]);
}
