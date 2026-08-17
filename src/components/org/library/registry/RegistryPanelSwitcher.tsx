"use client";

// PROTOTYPE SCAFFOLD — the Registry tab's A/B/C switcher (docs/REGISTRY-AND-CARE-IMPL.md §10).
// Throwaway: when a direction wins this collapses into a plain render and the losers are deleted.
// Three directions over the SAME RegistryView:
//   Ledger    — editorial single column; onboarding as a contents page filling in.
//   Blueprint — engineering drawing; repo tree + instrument readouts + a wiring diagram.
//   Pipeline  — left-to-right conveyor; the stepper is the pipeline lighting stage by stage.
// The choice rides the URL hash (#v=blueprint) so a reload mid-review keeps it — same pattern as
// FollowupsSwitcher.

import { useEffect, useState } from "react";
import { RegistryPanelLedger } from "./RegistryPanelLedger";
import { RegistryPanelBlueprint } from "./RegistryPanelBlueprint";
import { RegistryPanelPipeline } from "./RegistryPanelPipeline";
import type { RegistryView } from "@/lib/org/registry-view";

type Variant = "ledger" | "blueprint" | "pipeline";

const VARIANTS: { id: Variant; label: string; hint: string }[] = [
  { id: "ledger", label: "Ledger", hint: "Editorial: a masthead, ledger cells, onboarding as a contents page" },
  { id: "blueprint", label: "Blueprint", hint: "Schematic: repo file map, instrument readouts, a wiring diagram" },
  { id: "pipeline", label: "Pipeline", hint: "Flow: ascent → registry → fleet → developers, counters per edge" },
];

function readHash(): Variant {
  if (typeof window === "undefined") return "ledger";
  const m = /(?:^|[#&])v=(blueprint|pipeline)\b/.exec(window.location.hash);
  return (m?.[1] as Variant) ?? "ledger";
}

export function RegistryPanelSwitcher({ view, slug }: { view: RegistryView; slug: string }) {
  const [variant, setVariant] = useState<Variant>("ledger");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client hydration of the tab from the URL
    setVariant(readHash());
    const onHash = () => setVariant(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const pick = (v: Variant) => {
    setVariant(v);
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}${v === "ledger" ? "" : `#v=${v}`}`);
  };

  const props = { view, slug };
  return (
    <div className="space-y-5">
      <div
        className="flex flex-wrap items-center gap-2 rounded-xl border border-divider bg-surface/40 px-3 py-2"
        role="tablist"
        aria-label="Registry prototype variants"
      >
        <span className="mr-1 font-mono text-xs uppercase tracking-widest text-slate-500">Prototype</span>
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={variant === v.id}
            onClick={() => pick(v.id)}
            title={v.hint}
            className={`focus-ring rounded-full border px-3 py-1 font-mono text-xs transition ${variant === v.id ? "border-accent/60 bg-accent/10 text-white" : "border-divider text-slate-400 hover:border-accent hover:text-white"}`}
          >
            {v.label}
          </button>
        ))}
        <span className="ml-auto hidden font-mono text-xs text-slate-600 sm:inline">{VARIANTS.find((v) => v.id === variant)?.hint}</span>
      </div>

      {variant === "blueprint" ? (
        <RegistryPanelBlueprint {...props} />
      ) : variant === "pipeline" ? (
        <RegistryPanelPipeline {...props} />
      ) : (
        <RegistryPanelLedger {...props} />
      )}
    </div>
  );
}
