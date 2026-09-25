"use client";

// ⓘ TIPS — every caveat on L0 lives on the label it qualifies, not in a paragraph. A `Tip` is a
// focusable "i" carrying its text in `data-tip`; ONE tip box per desk follows hover and keyboard focus
// (delegated from the desk root), positioned beside the label and kept inside the viewport.

import { useEffect, useState, type RefObject } from "react";
import s from "./desk.module.css";

export function Tip({ text }: { text: string }) {
  return (
    <span className={s.tip} tabIndex={0} data-tip={text} aria-label={text} role="img">
      i
    </span>
  );
}

interface TipState {
  text: string;
  x: number;
  y: number;
}

const TIP_W = 340;

function place(el: HTMLElement): TipState {
  const r = el.getBoundingClientRect();
  const text = el.getAttribute("data-tip") ?? "";
  const x = Math.min(window.innerWidth - TIP_W - 12, Math.max(12, r.left + r.width / 2 - TIP_W / 2));
  const below = r.bottom + 8;
  const y = below + 120 > window.innerHeight ? Math.max(8, r.top - 128) : below;
  return { text, x, y };
}

/** Delegated listeners on the desk root; returns the box to render (or null). */
export function useTipBox(root: RefObject<HTMLElement | null>): TipState | null {
  const [tip, setTip] = useState<TipState | null>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const find = (t: EventTarget | null) => (t instanceof Element ? (t.closest("[data-tip]") as HTMLElement | null) : null);
    const over = (e: Event) => {
      const t = find(e.target);
      if (t) setTip(place(t));
    };
    const out = (e: Event) => {
      if (find(e.target)) setTip(null);
    };
    const hide = () => setTip(null);
    el.addEventListener("mouseover", over);
    el.addEventListener("mouseout", out);
    el.addEventListener("focusin", over);
    el.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      el.removeEventListener("mouseover", over);
      el.removeEventListener("mouseout", out);
      el.removeEventListener("focusin", over);
      el.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [root]);
  return tip;
}

export function TipBox({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div className={s.tipbox} role="tooltip" style={{ left: tip.x, top: tip.y, width: "max-content", maxWidth: TIP_W }}>
      {tip.text}
    </div>
  );
}
