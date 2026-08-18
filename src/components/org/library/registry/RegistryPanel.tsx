// The Registry tab's ONE render — the consolidated result of the prototype round (Ledger + Blueprint
// fused; the Pipeline direction and the A/B/C switcher were cut).
//
// Two shapes over the same `RegistryView`, chosen by whether a registry is identified:
//
//   NOT identified (`unmapped`, incl. the no-permission case) — the editorial invitation. A `Dateline`
//   masthead, the honest verdict, the three artifacts as they sit in ascent's tables today, and
//   onboarding as a numbered CONTENTS PAGE ("setting up the registry") you complete in any order.
//   Nothing is drawn, because there is no machine yet to draw.
//
//   IDENTIFIED (`scaffold_pr_open` · `indexed` · `migrating` · `error` · hosted mirror) — the
//   engineering drawing on top: the repo as a mono file map with counts and hashes, the artifact
//   counts beneath it, and the instrument column of readouts beside both. Below the drawing, the SAME
//   contents page carries the wiring that is still open (migrate → point the fleet → verify), then
//   fleet sync, telemetry, activity and the developer how-to.
//
// Server-safe (no hooks): the interactive pieces (`RegistryActions`, the stepper, the artifact ledger)
// carry their own `"use client"` boundaries.

import { Dateline, Kicker, SectionHeading } from "@/components/ui";
import { timeAgo } from "@/lib/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { MODE_LABEL, SINK_LABEL, registryVerdict, shortSha } from "./registryModel";
import { RegistryTreeMap } from "./RegistryTreeMap";
import { RegistryInstrumentPanel } from "./RegistryInstrumentPanel";
import { RegistryArtifactLedger } from "./RegistryArtifactLedger";
import { RegistryStepperIndex } from "./RegistryStepperIndex";
import { RegistryFleetSync } from "./RegistryFleetSync";
import { RegistryActivity } from "./RegistryActivity";
import { RegistryHowTo } from "./RegistryHowTo";
import { RegistryHeaderActions } from "./RegistryActions";

const STATUS_READ: Record<RegistryView["status"], string> = {
  unmapped: "not set up",
  scaffolding: "scaffolding",
  scaffold_pr_open: "scaffold pr open",
  indexed: "indexed",
  error: "index error",
};

function Masthead({ view, slug }: { view: RegistryView; slug: string }) {
  const r = view.registry;
  const left = r
    ? `${r.fullName} · ${r.canonical ? "canonical" : "secondary"} · ${MODE_LABEL[r.mode]}`
    : `${slug} · no registry mapped`;
  const right = r
    ? `indexed ${r.lastIndexedAt ? timeAgo(r.lastIndexedAt) : "never"} · ${shortSha(r.lastIndexSha)} · webhook ${r.webhookHealthy ? "ok" : "unconfirmed"} · telemetry ${SINK_LABEL[r.telemetrySink]}`
    : `status ${STATUS_READ[view.status]}`;
  return <Dateline left={left} right={right} />;
}

function ErrorLine({ view }: { view: RegistryView }) {
  if (!view.error) return null;
  return (
    <p className="rounded-xl border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-warn">
      <span className="font-mono text-xs uppercase tracking-[0.18em]">last index failed {timeAgo(view.error.at)} · </span>
      {view.error.message}
    </p>
  );
}

function Telemetry({ view }: { view: RegistryView }) {
  return (
    <div className="space-y-2">
      <Kicker tone="muted">Telemetry</Kicker>
      <p className="text-sm text-slate-400">
        Invocation counts only — never prompts, never code. The sink is{" "}
        <span className="font-mono text-slate-200">{SINK_LABEL[view.telemetry.sink]}</span>.
      </p>
      <div className="font-mono text-sm text-slate-300">
        <span className="text-2xl font-bold tabular-nums text-white">{view.telemetry.invokes30d.toLocaleString()}</span> invokes · 30d
      </div>
      <div className="font-mono text-xs text-slate-500">
        from <span className="tabular-nums text-slate-300">{view.telemetry.reposReporting}</span> repos
      </div>
    </div>
  );
}

/** The invitation: no registry identified yet, so nothing is drawn — only stated and offered. */
function UnmappedPanel({ view, slug }: { view: RegistryView; slug: string }) {
  return (
    <div className="stagger-children mx-auto max-w-4xl space-y-8">
      <Masthead view={view} slug={slug} />

      <SectionHeading
        size="page"
        kicker="The registry"
        title="Put your way of working in a repo you own"
        intro={registryVerdict(view)}
      />

      <ErrorLine view={view} />

      <RegistryArtifactLedger view={view} slug={slug} />

      {/* Step 1's three answers (create · map · stay hosted) render inside the active entry. */}
      <RegistryStepperIndex view={view} slug={slug} />

      <RegistryActivity view={view} limit={10} />

      <RegistryHowTo view={view} />
    </div>
  );
}

/** The drawing: a registry exists (or is one merge away), so its machine is inspectable. */
function IdentifiedPanel({ view, slug }: { view: RegistryView; slug: string }) {
  return (
    <div className="stagger-children space-y-8">
      <Masthead view={view} slug={slug} />

      <SectionHeading
        size="page"
        kicker="The registry"
        title="Your way of working, in a repo you own"
        intro={registryVerdict(view)}
        right={<RegistryHeaderActions view={view} slug={slug} />}
      />

      <ErrorLine view={view} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <RegistryTreeMap view={view} />
          <RegistryArtifactLedger view={view} slug={slug} heading="Artifact counts" />
        </div>
        <RegistryInstrumentPanel view={view} />
      </div>

      <RegistryStepperIndex view={view} slug={slug} kicker="Contents · wiring the registry" hideDone />

      <section className="grid gap-8 sm:grid-cols-2">
        <RegistryFleetSync view={view} slug={slug} layout="rows" />
        <Telemetry view={view} />
      </section>

      <RegistryActivity view={view} limit={10} />

      <RegistryHowTo view={view} />
    </div>
  );
}

export function RegistryPanel({ view, slug }: { view: RegistryView; slug: string }) {
  return view.status === "unmapped" ? <UnmappedPanel view={view} slug={slug} /> : <IdentifiedPanel view={view} slug={slug} />;
}
