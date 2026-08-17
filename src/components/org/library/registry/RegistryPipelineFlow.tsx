"use client";

// The Pipeline direction's spine: ascent → registry → fleet → developers as four STAGES with a live
// counter on each hand-off (index → catalog → sync → invoke), and the six onboarding steps distributed
// onto the stage each one energizes. The stepper IS the pipeline: a stage is lit when its own steps are
// satisfied, so "step 4 of 6" never has to be said out loud — you see where the light stops.
//
// The invoke edge is drawn as the RETURN leg (developers → ascent), because that is what closes the
// loop: usage counts flowing back are the only reason any of this pays off.
//
// Motion: entrance only, via the app's already-gated `.animate-fade-up` / `.animate-fade-in`.

import { Kicker } from "@/components/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { pipelineEdges, registrySteps, STEP_TONE, type RegistryStep } from "./registryModel";
import { RegistryChoiceActions, RegistryButton, fireIntent } from "./RegistryActions";

type StageId = "ascent" | "registry" | "fleet" | "dev";

const STAGES: { id: StageId; label: string; role: string; steps: RegistryStep["id"][] }[] = [
  { id: "ascent", label: "ascent", role: "indexes · opens PRs", steps: ["choose", "permissions"] },
  { id: "registry", label: "your registry", role: "the source of truth", steps: ["scaffold", "migrate"] },
  { id: "fleet", label: "fleet repos", role: "point at it", steps: ["point"] },
  { id: "dev", label: "developers", role: "sync · edit · PR back", steps: ["verify"] },
];

function Stage({
  label,
  role,
  steps,
  slug,
  view,
}: {
  label: string;
  role: string;
  steps: RegistryStep[];
  slug: string;
  view: RegistryView;
}) {
  const lit = steps.every((s) => s.state === "done" || s.state === "skipped");
  const active = !lit && steps.some((s) => s.state === "active" || s.state === "blocked");
  const border = lit ? "border-accent/50" : active ? "border-accent/30" : "border-divider";
  const bg = lit ? "bg-accent/5" : active ? "bg-surface/60" : "bg-surface/20";
  return (
    <div className={`animate-fade-up min-w-[10rem] flex-1 rounded-xl border ${border} ${bg} p-4`}>
      <div className="flex items-center gap-2">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${lit ? "bg-accent" : active ? "live-dot bg-accent" : "bg-slate-700"}`} aria-hidden />
        <span className={`font-mono text-sm ${lit || active ? "text-white" : "text-slate-500"}`}>{label}</span>
      </div>
      <div className="mt-0.5 font-mono text-xs text-slate-500">{role}</div>
      <ul className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.id}>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xs tabular-nums text-slate-600">{String(s.n).padStart(2, "0")}</span>
              <span className={`text-sm ${STEP_TONE[s.state].text}`}>{s.title}</span>
            </div>
            <div className="pl-6 font-mono text-xs text-slate-600">{s.detail}</div>
            {s.id === "choose" && s.state === "active" ? (
              <div className="mt-2 pl-6">
                <RegistryChoiceActions view={view} slug={slug} />
              </div>
            ) : null}
            {s.id === "permissions" && s.state === "blocked" && view.permission.installUrl ? (
              <div className="mt-2 pl-6">
                <RegistryButton href={view.permission.installUrl}>Grant contents:write ↗</RegistryButton>
              </div>
            ) : null}
            {s.id === "scaffold" && s.state === "active" && view.scaffoldPrUrl ? (
              <div className="mt-2 pl-6">
                <RegistryButton href={view.scaffoldPrUrl}>Review scaffold PR ↗</RegistryButton>
              </div>
            ) : null}
            {s.id === "point" && s.state === "active" ? (
              <div className="mt-2 pl-6">
                <RegistryButton onClick={() => fireIntent("propose-pointers", slug)}>Propose pointer PRs</RegistryButton>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Edge({ edge, dir = "forward" }: { edge: ReturnType<typeof pipelineEdges>[number]; dir?: "forward" | "return" }) {
  const tone = edge.stale ? "text-warn" : edge.live ? "text-accent" : "text-slate-600";
  const rule = edge.stale ? "bg-warn/40" : edge.live ? "bg-accent/60" : "bg-divider";
  return (
    <div className="flex min-w-[6rem] shrink-0 flex-col items-center justify-center gap-1 px-1 py-2">
      <span className={`font-mono text-xs uppercase tracking-[0.16em] ${tone}`}>{edge.label}</span>
      <div className="flex w-full items-center gap-1">
        {dir === "return" ? <span className={`font-mono text-xs ${tone}`}>◄</span> : null}
        <span className={`h-px flex-1 ${rule}`} aria-hidden />
        {dir === "forward" ? <span className={`font-mono text-xs ${tone}`}>►</span> : null}
      </div>
      <span className={`font-mono text-sm font-bold tabular-nums ${edge.live ? "text-white" : "text-slate-600"}`}>{edge.value}</span>
      <span className="text-center font-mono text-xs leading-tight text-slate-600">{edge.sub}</span>
    </div>
  );
}

export function RegistryPipelineFlow({ view, slug }: { view: RegistryView; slug: string }) {
  const steps = registrySteps(view);
  const byId = Object.fromEntries(steps.map((s) => [s.id, s])) as Record<RegistryStep["id"], RegistryStep>;
  const edges = pipelineEdges(view);
  // `pipelineEdges` always returns the four named edges in order; slicing (rather than destructuring)
  // keeps that fact expressed as a non-nullable array under noUncheckedIndexedAccess.
  const forward = edges.slice(0, 3);
  const invoke = edges[3];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="muted">The loop · index → catalog → sync → invoke</Kicker>
        <span className="font-mono text-xs text-slate-500">
          {steps.filter((s) => s.state === "done" || s.state === "skipped").length}/{steps.length} stages lit
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-divider bg-surface-strong/40 p-4">
        <div className="flex min-w-[54rem] items-stretch gap-1">
          {STAGES.map((st, i) => (
            <div key={st.id} className="flex flex-1 items-stretch gap-1">
              <Stage label={st.label} role={st.role} steps={st.steps.map((id) => byId[id])} slug={slug} view={view} />
              {forward[i] ? <Edge edge={forward[i]!} /> : null}
            </div>
          ))}
        </div>

        {/* the return leg: usage counts flowing back is what closes the loop. */}
        <div className="mt-4 flex min-w-[54rem] items-center gap-3 border-t border-divider pt-3">
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-slate-500">return leg</span>
          <div className="min-w-[12rem] flex-1">{invoke ? <Edge edge={invoke} dir="return" /> : null}</div>
          <p className="max-w-md text-xs text-slate-500">
            Counts only — which skill ran, how often, in which repo. Never prompts, never code. Turn it off entirely and everything
            above still works; you just lose the dormancy and outcome readings.
          </p>
        </div>
      </div>
    </div>
  );
}
