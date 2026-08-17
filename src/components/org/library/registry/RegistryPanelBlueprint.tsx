"use client";

// DIRECTION 2 — "Blueprint / Instrument".
//
// Metaphor: the registry is a MACHINE and this tab is its engineering drawing. Left column is the
// physical artifact — the repo as a mono file map with counts and hashes. Right column is the
// instrument panel — status readouts (indexed sha, catalog sha, webhook, sink) and sync dials. Beneath
// both, the wiring diagram shows which circuit between ascent, the registry and the fleet is closed —
// that IS the stepper.
//
// Differs from Ledger (pure type, no diagrams) by drawing the mechanism, and from Pipeline (a single
// left-to-right journey) by being a static schematic you inspect rather than a flow you watch.

import { Kicker, SectionHeading, Surface } from "@/components/ui";
import { timeAgo } from "@/lib/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { MODE_LABEL, SINK_LABEL, registryVerdict, shortSha } from "./registryModel";
import { RegistryTreeMap } from "./RegistryTreeMap";
import { RegistryWiringDiagram } from "./RegistryWiringDiagram";
import { RegistryFleetSync } from "./RegistryFleetSync";
import { RegistryArtifactLedger } from "./RegistryArtifactLedger";
import { RegistryActivity } from "./RegistryActivity";
import { RegistryHowTo } from "./RegistryHowTo";
import { RegistryChoiceActions, RegistryHeaderActions } from "./RegistryActions";

function Readout({ label, value, tone = "plain" }: { label: string; value: string; tone?: "plain" | "ok" | "warn" | "off" }) {
  const color =
    tone === "ok" ? "text-accent" : tone === "warn" ? "text-warn" : tone === "off" ? "text-slate-600" : "text-slate-200";
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="font-mono text-xs uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <span className={`font-mono text-sm tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

function InstrumentPanel({ view }: { view: RegistryView }) {
  const r = view.registry;
  return (
    <div className="space-y-2">
      <Kicker tone="muted">Readouts</Kicker>
      <Surface radius="xl" className="divide-y divide-divider px-4 py-2">
        <Readout label="repo" value={r?.fullName ?? "—"} tone={r ? "plain" : "off"} />
        <Readout label="branch" value={r?.defaultBranch ?? "—"} tone={r ? "plain" : "off"} />
        <Readout label="mode" value={r ? MODE_LABEL[r.mode] : "—"} tone={r ? "plain" : "off"} />
        <Readout label="canonical" value={r ? (r.canonical ? "yes" : "no") : "—"} tone={r ? "plain" : "off"} />
        <Readout label="index sha" value={shortSha(r?.lastIndexSha)} tone={view.status === "error" ? "warn" : r?.lastIndexSha ? "ok" : "off"} />
        <Readout label="indexed" value={r?.lastIndexedAt ? timeAgo(r.lastIndexedAt) : "never"} tone={r?.lastIndexedAt ? "plain" : "off"} />
        <Readout label="catalog sha" value={shortSha(r?.catalogSha)} tone={r?.catalogSha ? "ok" : "off"} />
        <Readout label="webhook" value={r ? (r.webhookHealthy ? "healthy" : "unconfirmed") : "—"} tone={r?.webhookHealthy ? "ok" : "warn"} />
        <Readout label="telemetry sink" value={SINK_LABEL[view.telemetry.sink]} tone={view.telemetry.sink === "off" ? "off" : "ok"} />
        <Readout label="invokes 30d" value={view.telemetry.invokes30d.toLocaleString()} tone={view.telemetry.invokes30d > 0 ? "plain" : "off"} />
        <Readout label="lessons" value={String(view.counts.lessons)} tone={view.counts.lessons > 0 ? "plain" : "off"} />
      </Surface>
      {view.error ? (
        <p className="rounded-xl border border-warn/40 bg-warn/5 px-3 py-2 font-mono text-xs text-warn">
          index fault {timeAgo(view.error.at)} — {view.error.message}
        </p>
      ) : null}
    </div>
  );
}

export function RegistryPanelBlueprint({ view, slug }: { view: RegistryView; slug: string }) {
  const mapped = view.status !== "unmapped";
  return (
    <div className="stagger-children space-y-6">
      <SectionHeading
        kicker="Registry · schematic"
        title={mapped ? "The registry, as drawn" : "The registry, as it would be built"}
        intro={registryVerdict(view)}
        right={mapped ? <RegistryHeaderActions view={view} slug={slug} /> : undefined}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <RegistryTreeMap view={view} />
          <RegistryArtifactLedger view={view} slug={slug} heading="Artifact counts" />
        </div>
        <div className="space-y-6">
          <InstrumentPanel view={view} />
          <RegistryFleetSync view={view} slug={slug} layout="rows" />
        </div>
      </div>

      <RegistryWiringDiagram view={view} />

      {!mapped ? (
        <Surface radius="xl" className="space-y-3 p-5">
          <Kicker tone="muted">Close the first circuit</Kicker>
          <p className="max-w-2xl text-sm text-slate-400">
            Nothing above exists yet. Pick where the registry lives and ascent opens the scaffold PR — you review it like any other
            change, and merging it is what makes it real.
          </p>
          <RegistryChoiceActions view={view} slug={slug} />
        </Surface>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <RegistryActivity view={view} limit={8} />
        <RegistryHowTo view={view} />
      </div>
    </div>
  );
}
