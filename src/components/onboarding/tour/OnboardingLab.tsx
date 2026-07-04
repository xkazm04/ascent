"use client";

// TEMPORARY prototyping harness — a floating switcher to A/B the three onboarding-tour directions on the
// live demo-org dashboard. Mounted in the org layout (gated to the demo org), so it persists across tab
// navigation and each variant can redirect + re-anchor. This is scaffolding: once a direction wins, the
// switcher is removed and the winning tour is triggered from a real entry point (a "Take the tour" CTA).

import { useCallback, useState } from "react";
import { Kicker } from "@/components/ui";
import { DEMO_TOUR_STEPS } from "./steps";
import { OnboardingSpotlight } from "./OnboardingSpotlight";
import { OnboardingChecklistRail } from "./OnboardingChecklistRail";
import { OnboardingBriefing } from "./OnboardingBriefing";

type Variant = "spotlight" | "checklist" | "briefing";

const VARIANTS: { id: Variant; label: string; hint: string }[] = [
  { id: "spotlight", label: "Spotlight", hint: "Blocking coach-marks" },
  { id: "checklist", label: "Checklist", hint: "Non-blocking companion" },
  { id: "briefing", label: "Briefing", hint: "Narrated concept deck" },
];

export function OnboardingLab({ slug }: { slug: string }) {
  const [active, setActive] = useState<Variant | null>(null);
  // Stable so the engine's Escape listener (keyed on onExit) binds once, not every render.
  const stop = useCallback(() => setActive(null), []);

  return (
    <>
      <div className="animate-fade-up fixed bottom-4 right-4 z-[80] w-64 rounded-2xl border border-divider bg-surface-strong p-3 shadow-2xl ring-1 ring-white/5">
        <div className="flex items-center justify-between">
          <Kicker>Onboarding lab</Kicker>
          <span className="font-mono text-xs uppercase tracking-widest text-slate-600">prototype</span>
        </div>
        <p className="mt-1 text-sm text-slate-500">Preview a demo-org tour direction.</p>
        <div className="mt-2 grid gap-1.5">
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setActive(v.id)}
              aria-pressed={active === v.id}
              className={`focus-ring flex flex-col rounded-lg border px-3 py-2 text-left transition ${
                active === v.id
                  ? "border-accent bg-accent/10"
                  : "border-slate-800 hover:border-slate-700 hover:bg-white/5"
              }`}
            >
              <span className={`text-sm font-medium ${active === v.id ? "text-white" : "text-slate-200"}`}>{v.label}</span>
              <span className="font-mono text-xs text-slate-500">{v.hint}</span>
            </button>
          ))}
        </div>
        {active && (
          <button
            type="button"
            onClick={stop}
            className="focus-ring mt-2 w-full rounded-lg border border-slate-700 px-3 py-1.5 font-mono text-sm uppercase tracking-widest text-slate-300 transition hover:border-danger hover:text-danger-soft"
          >
            Stop tour
          </button>
        )}
      </div>

      {active === "spotlight" && <OnboardingSpotlight slug={slug} steps={DEMO_TOUR_STEPS} onExit={stop} />}
      {active === "checklist" && <OnboardingChecklistRail slug={slug} steps={DEMO_TOUR_STEPS} onExit={stop} />}
      {active === "briefing" && <OnboardingBriefing slug={slug} steps={DEMO_TOUR_STEPS} onExit={stop} />}
    </>
  );
}
