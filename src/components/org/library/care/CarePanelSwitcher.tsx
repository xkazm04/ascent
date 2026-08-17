"use client";

// The prototype's variant switcher (docs/REGISTRY-AND-CARE-IMPL.md §10). Throwaway chrome, but styled
// with brand tokens so it does not read as scaffolding while the direction is being judged.
//
// All three variants take IDENTICAL props `{ view, slug }`, so the winner can replace this wrapper with
// a direct render and nothing else changes.

import { useState } from "react";
import { Kicker } from "@/components/ui";
import { CarePanelCompanion } from "./CarePanelCompanion";
import { CarePanelClimb } from "./CarePanelClimb";
import { CarePanelCockpit } from "./CarePanelCockpit";
import { CARE_DEMO_STATES } from "@/lib/org/care-view.fixture";
import type { CareView } from "@/lib/org/care-view";

const VARIANTS = [
  { id: "companion", label: "Companion", hint: "A private notebook: profile, a board of moves, dated retros." },
  { id: "climb", label: "Climb", hint: "Your ascent: a trajectory of kept moves, habits as altitude, moves as handholds." },
  { id: "cockpit", label: "Cockpit", hint: "The flight deck: session dials, moves as adjustments, privacy as a switch panel." },
] as const;

type VariantId = (typeof VARIANTS)[number]["id"];

export function CarePanelSwitcher({ view, slug }: { view: CareView; slug: string }) {
  const [variant, setVariant] = useState<VariantId>("companion");
  const active = VARIANTS.find((v) => v.id === variant)!;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-divider bg-surface/40 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-center gap-1">
            <Kicker className="mr-3">Direction</Kicker>
            {VARIANTS.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={v.id === variant}
                onClick={() => setVariant(v.id)}
                className={`focus-ring rounded-md px-3 py-1.5 font-mono text-sm uppercase tracking-widest transition-colors ${
                  v.id === variant ? "bg-accent/15 text-accent" : "text-slate-500 hover:text-slate-200"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Kicker tone="muted" className="mr-3">
              Fixture
            </Kicker>
            {CARE_DEMO_STATES.map((d) => (
              <a
                key={d}
                href={`/org/${encodeURIComponent(slug)}?tab=care&demo=${d}`}
                className={`focus-ring rounded-md px-2.5 py-1.5 font-mono text-sm transition-colors ${
                  view.demo === d ? "bg-surface text-slate-200" : "text-slate-500 hover:text-slate-200"
                }`}
              >
                {d}
              </a>
            ))}
            <a
              href={`/org/${encodeURIComponent(slug)}?tab=care`}
              className={`focus-ring rounded-md px-2.5 py-1.5 font-mono text-sm transition-colors ${
                view.demo ? "text-slate-500 hover:text-slate-200" : "bg-surface text-slate-200"
              }`}
            >
              live
            </a>
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-500">{active.hint}</p>
      </div>

      {variant === "companion" ? <CarePanelCompanion view={view} slug={slug} /> : null}
      {variant === "climb" ? <CarePanelClimb view={view} slug={slug} /> : null}
      {variant === "cockpit" ? <CarePanelCockpit view={view} slug={slug} /> : null}
    </div>
  );
}
