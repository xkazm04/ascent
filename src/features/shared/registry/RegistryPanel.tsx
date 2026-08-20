// The Registry tab's ONE render — the consolidated result of the prototype round (Ledger + Blueprint
// fused; the Pipeline direction and the A/B/C switcher were cut).
//
// Two shapes over the same `RegistryView`, chosen by whether a registry is identified:
//
//   NOT identified (`unmapped`, incl. the no-permission case) — the editorial invitation. A `Dateline`
//   masthead, the honest verdict, and onboarding as a numbered CONTENTS PAGE ("setting up the
//   registry") you complete in any order. Nothing is DRAWN and nothing is COUNTED, because there is no
//   machine yet to draw and no registry yet to count against — the artifact ledger belongs to the
//   identified shape only.
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

/** The invitation: no registry identified yet, so nothing is drawn — only stated and offered.
 *
 *  FULL WIDTH, like every sibling tab. It used to sit in a centred `max-w-4xl` column, which was the
 *  prototype's editorial framing and made this the one tab in the group that looked like a different
 *  product. The reading order is preserved by the GRID instead: the setup contents page takes the wide
 *  column, and the layout that a scaffold PR would add sits beside it as the thing being proposed. */
function UnmappedPanel({ view, slug }: { view: RegistryView; slug: string }) {
  return (
    <div className="stagger-children space-y-8">
      <Masthead view={view} slug={slug} />

      <SectionHeading
        size="page"
        kicker="The registry"
        title="Put your way of working in a repo you own"
        intro={registryVerdict(view)}
      />

      <ErrorLine view={view} />

      {/* No artifact ledger here. The three Stat cards read `n in the registry / +m hosted only` —
          a reading of a registry that does not exist yet, so every cell was a zero with a migrate
          action that could only answer "map a registry first". The identified panel below renders
          the same ledger the moment there IS something for it to count. */}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Step 1's real answers (create · map, the map path with a picker of the repos ascent can
            already see) render inside the active entry. */}
        <RegistryStepperIndex view={view} slug={slug} />
        <div className="space-y-6">
          <RegistryTreeMap view={view} />
          <RegistryHowTo view={view} />
        </div>
      </div>

      <RegistryActivity view={view} limit={10} />
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
