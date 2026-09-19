"use client";

// INFOTIP — the brand's answer to a paragraph nobody asked for yet.
//
// WHY IT EXISTS. Several control surfaces carry a standing explanation under the control: what the
// verification dial executes, what a brief is assembled from, what "land in my current branch" does
// to a working copy. Each paragraph is TRUE and worth having — and rendered inline, five of them turn
// a setup panel into an essay whose controls you have to hunt for. So the sentence keeps its place in
// the product and loses its place on the page: it lives one click away, on the label it belongs to.
//
// WHAT THIS IS NOT. It is not a substitute for a warning. A consequence the operator must read BEFORE
// they act (a mode that writes to their checkout, a guard they have switched off) stays on the page as
// a visible line — hiding that behind a click would be the trade this component exists to make in the
// other direction. Use an InfoTip for the explanation, never for the alarm.
//
// A BUTTON, NOT A `title`. The native attribute is invisible to touch, unreadable to most screen
// readers as prose, and unstyleable. This is a real toggle: `aria-expanded`, a keyboard-reachable
// trigger, Escape and blur to dismiss, and a `role="tooltip"` panel wired through `aria-describedby`
// so the sentence is ANNOUNCED rather than merely drawn.

import { useId, useState } from "react";

export function InfoTip({
  /** What the sentence is ABOUT — the trigger's accessible name ("what the guard runs"). */
  label,
  /** Which edge the panel is pinned to. `right` for a trigger near the right edge of its container. */
  align = "left",
  children,
}: {
  label: string;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className="relative inline-flex align-middle"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
      // A click elsewhere moves focus out of the wrapper; anything still inside it (the panel's own
      // links) keeps the panel open. `relatedTarget` is null on a click into dead space, which closes.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`focus-ring grid h-4 w-4 shrink-0 place-items-center rounded-full border type-micro font-semibold leading-none transition ${
          open ? "border-accent bg-accent/15 text-accent" : "border-slate-600 text-slate-500 hover:border-accent hover:text-accent"
        }`}
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`animate-fade-in absolute top-6 z-30 w-72 rounded-lg border border-divider bg-surface-strong p-3 type-note leading-relaxed text-slate-300 shadow-2xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </span>
      )}
    </span>
  );
}
