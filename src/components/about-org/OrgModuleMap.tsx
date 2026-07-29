"use client";

// The module map — this deck's centrepiece.
//
// Marketing pages usually describe an information architecture in prose and hope the reader assembles
// it. This one RENDERS the architecture: the same six module groups, in the same order, wearing the
// same icons as the shipping rail (`SectionRailNav` on /org/[slug]), because it is built from the same
// catalog (see orgModules.ts). Picking a module reveals its real views, each linking into that view in
// the live demo. A visitor learns the product's navigation before signing up, and what they learn is
// true by construction.
//
// The interaction is a tablist, not a link list, so the whole map fits one deck pane instead of
// becoming a 21-row wall — and it is a *real* tablist: roving tabindex, arrow/Home/End keys, correct
// aria wiring, so it is operable without a mouse.

import { useRef, useState } from "react";
import Link from "next/link";
import { Kicker } from "@/components/ui";
import { FleetIcon, GovernIcon, IntelligenceIcon, LibraryIcon, OverviewIcon, PlanIcon } from "@/components/org/overview/orgIcons";
import { ABOUT_ORG_MODULES } from "./orgModules";

// Keyed by the catalog's group key — the same lookup OrgTabNav does, so a module can't show up here
// wearing a different glyph than it wears inside the product.
const ICONS: Record<string, React.ReactNode> = {
  overview: <OverviewIcon size={22} />,
  fleet: <FleetIcon size={22} />,
  intelligence: <IntelligenceIcon size={22} />,
  plan: <PlanIcon size={22} />,
  library: <LibraryIcon size={22} />,
  govern: <GovernIcon size={22} />,
};

export function OrgModuleMap() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Not `module` — @next/next/no-assign-module-variable bans that identifier (it shadows the CommonJS
  // `module` and can silently break a bundled chunk).
  const current = ABOUT_ORG_MODULES[active]!;

  // Roving-tabindex keyboard model (WAI-ARIA tabs): arrows move AND select, Home/End jump to the ends.
  // Focus follows selection, so a keyboard user hears the newly revealed panel without a second key.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = ABOUT_ORG_MODULES.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? active === last
          ? 0
          : active + 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? active === 0
            ? last
            : active - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  return (
    // overflow-hidden is load-bearing, not cosmetic: it clips the trailing border of the panel grid's
    // last column/row (which the -mr-px/-mb-px pull under this wrapper's own hairline) so the panel
    // never shows a doubled 2px edge.
    <div className="tick-corners overflow-hidden rounded-2xl border border-divider bg-surface-strong/30">
      <div
        role="tablist"
        aria-label="Organization modules"
        onKeyDown={onKeyDown}
        className="grid grid-cols-3 gap-px border-b border-divider bg-divider lg:grid-cols-6"
      >
        {ABOUT_ORG_MODULES.map((m, i) => {
          const on = i === active;
          return (
            <button
              key={m.key}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`module-tab-${m.key}`}
              aria-selected={on}
              aria-controls={`module-panel-${m.key}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(i)}
              className={`focus-ring flex flex-col items-center gap-2 bg-ink px-3 py-4 transition ${
                on ? "text-accent" : "text-slate-500 hover:bg-surface/40 hover:text-slate-200"
              }`}
            >
              <span aria-hidden>{ICONS[m.key]}</span>
              <span className="font-mono text-[11px] uppercase tracking-[0.18em]">{m.label}</span>
              <span className="font-mono text-[10px] tabular-nums text-slate-600">
                {m.views.length} {m.views.length === 1 ? "view" : "views"}
              </span>
              {/* The active marker is a rule under the cell, not a fill — the rail's own idiom. */}
              <span aria-hidden className={`h-px w-8 transition ${on ? "bg-accent" : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>

      {/* EVERY module's panel is rendered, stacked into one grid cell, with the inactive ones hidden
          via `visibility` rather than unmounted. Three things fall out of that, all of them wanted:
            1. No layout shift. The container is as tall as the TALLEST panel (Intelligence and Govern
               carry five views, Overview two), so switching modules never resizes the section — which
               on a scroll-snap deck would also move the snap point out from under the reader.
            2. No ragged hairline bed. Cells carry their own `border-r/border-b` (with the trailing
               row/column clipped by the -mr/-mb) instead of the old `gap-px` over a `bg-divider`
               container, whose unoccupied cells painted as a bare grey block on any module whose view
               count didn't divide evenly by the column count.
            3. All 21 views ship in the server HTML. A page whose headline claims "21 views" should be
               able to prove it to a crawler that never clicks a tab.
          `visibility: hidden` (Tailwind's `invisible`) is the right hide here: it keeps the box for
          sizing while removing the subtree from the accessibility tree AND the tab order, so an
          inactive tabpanel is genuinely inert without needing aria-hidden bolted on. */}
      <div className="grid">
        {ABOUT_ORG_MODULES.map((m, i) => (
          <div
            key={m.key}
            role="tabpanel"
            id={`module-panel-${m.key}`}
            aria-labelledby={`module-tab-${m.key}`}
            className={`col-start-1 row-start-1 -mb-px -mr-px grid transition-opacity duration-200 sm:grid-cols-2 lg:grid-cols-3 ${
              i === active ? "opacity-100" : "invisible opacity-0"
            }`}
          >
            {m.views.map((v) => (
              <Link
                key={v.id}
                href={v.href}
                className="focus-ring group flex flex-col border-b border-r border-divider p-5 transition hover:bg-surface/40 2xl:p-6"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-base font-semibold text-white group-hover:text-accent">{v.label}</span>
                  <span aria-hidden className="font-mono text-slate-700 transition group-hover:translate-x-0.5 group-hover:text-accent">
                    →
                  </span>
                </span>
                <span className="mt-2 text-sm leading-relaxed text-slate-400 2xl:text-base">{v.blurb}</span>
              </Link>
            ))}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider px-5 py-3">
        <Kicker tone="muted">{current.label} · live demo links</Kicker>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-600">
          ← → to change module
        </span>
      </div>
    </div>
  );
}
