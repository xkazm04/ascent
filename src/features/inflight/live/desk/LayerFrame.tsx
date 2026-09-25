"use client";

// THE INNER LAYER'S FRAME — breadcrumbs, prev/next, "Esc · desk", and the scrolling document under
// them. Esc goes back to the desk, `[` and `]` walk prev/next; the page behind stops scrolling while the
// layer is open, and the document takes focus (and scrolls to its top) whenever it changes.

import { useEffect, useRef, type ReactNode } from "react";
import type { NavTarget } from "./DocParts";
import type { DeskRoute } from "./deskRoute";
import l from "./deskLayers.module.css";
import s from "./desk.module.css";

export interface Crumb {
  label: string;
  /** Null = the desk itself; undefined = the current page (not a link). */
  to?: DeskRoute | null;
}

interface Props {
  crumbs: Crumb[];
  prev: NavTarget | null;
  next: NavTarget | null;
  go: (to: DeskRoute | null) => void;
  docKey: string;
  children: ReactNode;
}

export function LayerFrame({ crumbs, prev, next, go, docKey, children }: Props) {
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    el.scrollTop = 0;
    el.focus({ preventScroll: true });
  }, [docKey]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof Element && t.closest("input,textarea,select")) return;
      if (e.key === "Escape") go(null);
      else if (e.key === "[" && prev) go(prev.to);
      else if (e.key === "]" && next) go(next.to);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [go, prev, next]);

  const label = crumbs[crumbs.length - 1]?.label ?? "Desk";
  return (
    <div className={l.layer} role="dialog" aria-modal="true" aria-label={label} data-role="desk-layer">
      <div className={l.lbar}>
        <nav className={l.crumbs} aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: "contents" }}>
              {i ? <span className={l.sep}>›</span> : null}
              {c.to !== undefined && i < crumbs.length - 1 ? (
                <button type="button" onClick={() => go(c.to ?? null)}>
                  {c.label}
                </button>
              ) : (
                <b>{c.label}</b>
              )}
            </span>
          ))}
        </nav>
        <div className={l.lnav}>
          <button type="button" className={`${s.btn} ${s.sm}`} disabled={!prev} title="Previous ([)" onClick={() => prev && go(prev.to)}>
            ← {prev ? (prev.short ?? prev.label) : ""}
          </button>
          <button type="button" className={`${s.btn} ${s.sm}`} disabled={!next} title="Next (])" onClick={() => next && go(next.to)}>
            {next ? (next.short ?? next.label) : ""} →
          </button>
        </div>
        <button type="button" className={`${s.btn} ${s.ghost} ${s.sm}`} title="Back to the desk (Esc)" onClick={() => go(null)}>
          Esc · desk
        </button>
      </div>
      <div className={l.lbody} ref={body} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
