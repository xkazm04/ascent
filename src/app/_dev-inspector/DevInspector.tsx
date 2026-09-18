"use client";

/**
 * DevInspector — a dev-only "click a component, copy its source path" overlay.
 *
 * Usage (mirrors the personas desktop app):
 *   1. Launch with `npm run dev:inspect` (sets DEV_INSPECT=1 so the Turbopack
 *      loader stamps host elements with `data-loc`).
 *   2. Click the bottom-right Inspect chip (or press `;` then `i`) to arm.
 *   3. Hover highlights the element; RIGHT-CLICK copies a Claude-Code-friendly
 *      `src/.../File.tsx:LINE` to the clipboard (left-click is left untouched so
 *      you can keep operating the app). Default copy = the INNERMOST NON-LIBRARY
 *      file in the chain (skipping shared roots like src/lib/ and
 *      src/components/ui/ — see LIBRARY_ROOTS in devLocate.ts). For a feature
 *      component that is the component's own file; it is only the page-level
 *      call site when the pointed-at element is library code. Alt+right-click
 *      copies the innermost element regardless; click a HUD row to copy any
 *      enclosing file. While armed, Enter or `c` copies the selected HUD crumb
 *      (the default loc until ↑/↓ moves the selection). A HUD `code -g` action
 *      copies the editor CLI deep-link for the default target — Alt+right-click
 *      is not a format switch.
 *   4. `Esc` returns to the Inspect chip.
 *
 * Mounted only behind `process.env.NODE_ENV === 'development'` in the root
 * layout, so the module is absent from production. Without `dev:inspect` there
 * are no `data-loc` attributes and the idle chip says how to enable mapping.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useInspectorKeys, type InspectorMode } from "./devInspectorKeys";
import { buildChain, dedupeChain, defaultCrumbIndex, formatHudCopy, pickDefaultIndex, type LocEntry } from "./devLocate";
import { HighlightBox, InspectChip, InspectorHud, NavHint, SourceLabel, Z } from "./devInspectorUi";

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

interface HoverState {
  chain: LocEntry[];
  pointerRect: DOMRect;
  targetRect: DOMRect;
  defaultIndex: number;
}

export function DevInspector() {
  const [mode, setMode] = useState<InspectorMode>("off");
  const [hover, setHover] = useState<HoverState | null>(null);
  // "The pointer is over an element that carries no `data-loc` anywhere up its ancestry" — a DIFFERENT
  // state from "you haven't moved the mouse yet", and the HUD must say which. Collapsing them is the
  // failure uninstrumented-degradation names: the operator cannot tell "I clicked wrong" from "this
  // element has no source", tries twice, gets nothing twice, and stops reaching for the tool.
  const [unstamped, setUnstamped] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyOk, setCopyOk] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Live mirror of `mode` so the (subscribe-once) keydown handler never reads a stale closure: written
  // synchronously on every keystroke transition below, and synced here as a backstop for the timer-driven
  // auto-off. A rapid ';'→'i' can't miss arming on a not-yet-committed render.
  const modeRef = useRef<InspectorMode>(mode);
  const hoverRef = useRef<HoverState | null>(null);
  const selectedRef = useRef(0);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot client-mount gate (dev inspector)
  useEffect(() => setMounted(true), []);

  const doCopy = useCallback(async (loc: string) => {
    const ok = await copyText(loc);
    setCopyOk(ok);
    setCopied(loc);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 1800);
  }, []);

  useInspectorKeys({ modeRef, setMode, hoverRef, selectedRef, setSelectedIndex, doCopy });

  // Auto-exit nav mode after 2s if the second key isn't pressed. Lives in an effect (not the setMode
  // updater) so the reducer stays pure: the timer is set on entering nav and cleared on cleanup, so it
  // can't be double-scheduled/leaked, and switching to armed/off cancels it.
  useEffect(() => {
    if (mode !== "nav") return;
    const t = setTimeout(() => setMode((cur) => (cur === "nav" ? "off" : cur)), 2000);
    return () => clearTimeout(t);
  }, [mode]);

  // Hover highlight + right-click copy, only while armed.
  useEffect(() => {
    if (mode !== "armed") return;

    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = "crosshair";

    const insideHud = (t: EventTarget | null) =>
      t instanceof Element && t.closest("[data-devinspector]") !== null;

    const onMove = (e: MouseEvent) => {
      if (insideHud(e.target)) return; // keep last highlight while over the HUD
      const chain = buildChain(e.target as Element | null);
      if (chain.length === 0 || !chain[0]) {
        hoverRef.current = null;
        selectedRef.current = 0;
        setHover(null);
        setSelectedIndex(0);
        setUnstamped(true);
        return;
      }
      setUnstamped(false);
      const di = pickDefaultIndex(chain);
      const next: HoverState = {
        chain,
        pointerRect: chain[0].el.getBoundingClientRect(),
        targetRect: (chain[di] ?? chain[0]).el.getBoundingClientRect(),
        defaultIndex: di,
      };
      hoverRef.current = next;
      const sel = defaultCrumbIndex(dedupeChain(chain), next.chain[di]?.loc ?? null);
      selectedRef.current = sel;
      setSelectedIndex(sel);
      setHover(next);
    };

    // Right-click copies (and suppresses the context menu). Left-click is left
    // alone so the app stays usable while armed.
    const onContextMenu = (e: MouseEvent) => {
      if (insideHud(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const chain = buildChain(e.target as Element | null);
      if (chain.length === 0 || !chain[0]) return;
      const di = pickDefaultIndex(chain);
      const pick = e.altKey ? chain[0] : (chain[di] ?? chain[0]);
      void doCopy(formatHudCopy(pick.loc));
    };

    // The highlight/label rects are captured from getBoundingClientRect on mousemove and rendered as
    // position:fixed. Scroll/resize/reflow move the underlying elements WITHOUT firing mousemove, so
    // the boxes would freeze at stale viewport coordinates and point at the wrong element. Re-measure
    // from the stored chain elements (already in `hover`) on a rAF tick so the boxes track the element.
    let raf = 0;
    const reposition = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setHover((h) => {
          if (!h) return h;
          const pointerEl = h.chain[0]?.el;
          if (!pointerEl || !pointerEl.isConnected) {
            hoverRef.current = null;
            return null; // detached by a re-render → drop it
          }
          const targetEl = h.chain[h.defaultIndex]?.el ?? pointerEl;
          const next = {
            ...h,
            pointerRect: pointerEl.getBoundingClientRect(),
            targetRect: targetEl.getBoundingClientRect(),
          };
          hoverRef.current = next;
          return next;
        });
      });
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    // capture:true so scrolls inside any nested scroll container (not just the window) re-measure too.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.body.style.cursor = prevCursor;
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      cancelAnimationFrame(raf);
      hoverRef.current = null;
      setHover(null);
      setUnstamped(false);
    };
  }, [mode, doCopy]);

  useEffect(
    () => () => {
      clearTimeout(copiedTimer.current);
    },
    [],
  );

  if (!mounted) return null;

  const mappingOn = document.querySelector("[data-loc]") !== null;
  const chip = (
    <InspectChip
      mappingOn={mappingOn}
      onArm={() => {
        modeRef.current = "armed";
        setMode("armed");
      }}
    />
  );

  if (mode === "off") return createPortal(chip, document.body);

  if (mode === "nav") {
    return createPortal(
      <div style={{ position: "fixed", inset: 0, zIndex: Z, pointerEvents: "none" }}>
        <NavHint />
      </div>,
      document.body,
    );
  }

  // armed — chip stays bottom-right, below / beside the HUD
  const defaultLoc =
    hover && hover.chain[hover.defaultIndex] ? hover.chain[hover.defaultIndex]!.loc : null;
  const crumbs = hover ? dedupeChain(hover.chain) : [];

  return createPortal(
    <div data-devinspector style={{ position: "fixed", inset: 0, zIndex: Z, pointerEvents: "none" }}>
      {hover && hover.defaultIndex !== 0 && (
        <HighlightBox rect={hover.pointerRect} variant="pointer" />
      )}
      {hover && <HighlightBox rect={hover.targetRect} variant="target" />}
      {/* Anchor the chip to the TARGET box (cyan) — it shows defaultLoc, which is the target/call-site
          element's path and shares the cyan colour. Pinning it to pointerRect floated the cyan label
          over the purple pointer box, breaking the colour→region association. */}
      {hover && defaultLoc && <SourceLabel rect={hover.targetRect} loc={defaultLoc} />}

      <InspectorHud
        copied={copied}
        copyOk={copyOk}
        mappingOn={mappingOn}
        crumbs={crumbs}
        unstamped={unstamped}
        defaultLoc={defaultLoc}
        selectedIndex={selectedIndex}
        onCopy={doCopy}
      />
      {chip}
    </div>,
    document.body,
  );
}
