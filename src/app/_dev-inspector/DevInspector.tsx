"use client";

/**
 * DevInspector — a dev-only "click a component, copy its source path" overlay.
 *
 * Usage (mirrors the personas desktop app):
 *   1. Launch with `npm run dev:inspect` (sets DEV_INSPECT=1 so the Turbopack
 *      loader stamps host elements with `data-loc`).
 *   2. Press `;` to enter keyboard mode, then `i` to arm the inspector.
 *   3. Hover highlights the element; RIGHT-CLICK copies a Claude-Code-friendly
 *      `src/.../File.tsx:LINE` to the clipboard (left-click is left untouched so
 *      you can keep operating the app). Default copy = the call site (the
 *      feature/page file that used the component); Alt+right-click copies the
 *      innermost element; click a HUD row to copy any enclosing file.
 *   4. `Esc` exits.
 *
 * Mounted only behind `process.env.NODE_ENV === 'development'` in the root
 * layout, so the module is absent from production. Without `dev:inspect` there
 * are no `data-loc` attributes and the HUD says how to enable source mapping.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { buildChain, dedupeChain, pickDefaultIndex, type LocEntry } from "./devLocate";
import { HighlightBox, InspectorHud, NavHint, SourceLabel, Z } from "./devInspectorUi";

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

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

type Mode = "off" | "nav" | "armed";

interface HoverState {
  chain: LocEntry[];
  pointerRect: DOMRect;
  targetRect: DOMRect;
  defaultIndex: number;
}

export function DevInspector() {
  const [mode, setMode] = useState<Mode>("off");
  const [hover, setHover] = useState<HoverState | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyOk, setCopyOk] = useState(true);
  const [mounted, setMounted] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Live mirror of `mode` so the (subscribe-once) keydown handler never reads a stale closure: written
  // synchronously on every keystroke transition below, and synced here as a backstop for the timer-driven
  // auto-off. A rapid ';'→'i' can't miss arming on a not-yet-committed render.
  const modeRef = useRef<Mode>(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => setMounted(true), []);

  const doCopy = useCallback(async (loc: string) => {
    const ok = await copyText(loc);
    setCopyOk(ok);
    setCopied(loc);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 1800);
  }, []);

  // `;` enters keyboard mode, then `i` arms the inspector; Esc exits. Subscribed once (no `mode` dep) and
  // driven off `modeRef` so there's no add/remove gap between a `;` dispatch and a re-subscribe where the
  // handler would still see the old `mode` — `modeRef` is updated synchronously on each transition.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === ";") {
        e.preventDefault();
        // nav→off, off→nav, armed unchanged. Computed from the live ref (not the setMode updater, so the
        // reducer stays pure); the 2s auto-off is scheduled by the effect below keyed on mode === "nav".
        const next: Mode = modeRef.current === "armed" ? "armed" : modeRef.current === "nav" ? "off" : "nav";
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

      if (e.key === "Escape" && modeRef.current !== "off") {
        modeRef.current = "off";
        setMode("off");
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

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
        setHover(null);
        return;
      }
      const di = pickDefaultIndex(chain);
      setHover({
        chain,
        pointerRect: chain[0].el.getBoundingClientRect(),
        targetRect: (chain[di] ?? chain[0]).el.getBoundingClientRect(),
        defaultIndex: di,
      });
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
      void doCopy(pick.loc);
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
          if (!pointerEl || !pointerEl.isConnected) return null; // detached by a re-render → drop it
          const targetEl = h.chain[h.defaultIndex]?.el ?? pointerEl;
          return {
            ...h,
            pointerRect: pointerEl.getBoundingClientRect(),
            targetRect: targetEl.getBoundingClientRect(),
          };
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
      setHover(null);
    };
  }, [mode, doCopy]);

  useEffect(
    () => () => {
      clearTimeout(copiedTimer.current);
    },
    [],
  );

  if (!mounted || mode === "off") return null;

  if (mode === "nav") {
    return createPortal(
      <div style={{ position: "fixed", inset: 0, zIndex: Z, pointerEvents: "none" }}>
        <NavHint />
      </div>,
      document.body,
    );
  }

  // armed
  const mappingOn = document.querySelector("[data-loc]") !== null;
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
        defaultLoc={defaultLoc}
        onCopy={doCopy}
      />
    </div>,
    document.body,
  );
}
