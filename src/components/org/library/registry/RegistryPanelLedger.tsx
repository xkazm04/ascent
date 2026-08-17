"use client";

// DIRECTION 1 — "Ledger / Index".
//
// Metaphor: the registry is a PUBLICATION and this tab is its front matter. A Dateline masthead states
// the edition (repo, mode, indexed sha), one verdict line says where you stand, the three artifacts
// read as ledger cells, and onboarding is a numbered CONTENTS PAGE filling in rather than a wizard
// pushing you forward. Single column, hairline rules, no chrome that isn't a rule or a number — the
// editorial half of the brand ("The Index").
//
// Differs from Blueprint (which draws the machine) and Pipeline (which animates the flow) by refusing
// diagrams entirely: everything is type, rules and dated entries.

import { Dateline, Kicker, SectionHeading } from "@/components/ui";
import { timeAgo } from "@/lib/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { MODE_LABEL, SINK_LABEL, registryVerdict, shortSha } from "./registryModel";
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
  const left = r ? `${r.fullName} · ${r.canonical ? "canonical" : "secondary"} · ${MODE_LABEL[r.mode]}` : `${slug} · no registry mapped`;
  const right = r
    ? `indexed ${r.lastIndexedAt ? timeAgo(r.lastIndexedAt) : "never"} · ${shortSha(r.lastIndexSha)} · webhook ${r.webhookHealthy ? "ok" : "unconfirmed"} · telemetry ${SINK_LABEL[r.telemetrySink]}`
    : `status ${STATUS_READ[view.status]}`;
  return <Dateline left={left} right={right} />;
}

export function RegistryPanelLedger({ view, slug }: { view: RegistryView; slug: string }) {
  const mapped = view.status !== "unmapped";

  return (
    <div className="stagger-children mx-auto max-w-4xl space-y-8">
      <Masthead view={view} slug={slug} />

      <SectionHeading
        size="page"
        kicker="The registry"
        title={mapped ? "Your way of working, in a repo you own" : "Put your way of working in a repo you own"}
        intro={registryVerdict(view)}
        right={mapped ? <RegistryHeaderActions view={view} slug={slug} /> : undefined}
      />

      {view.error ? (
        <p className="rounded-xl border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-warn">
          <span className="font-mono text-xs uppercase tracking-[0.18em]">last index failed {timeAgo(view.error.at)} · </span>
          {view.error.message}
        </p>
      ) : null}

      <RegistryArtifactLedger view={view} slug={slug} />

      <RegistryStepperIndex view={view} slug={slug} />

      {mapped ? (
        <section className="grid gap-8 sm:grid-cols-2">
          <RegistryFleetSync view={view} slug={slug} layout="rows" />
          <div className="space-y-2">
            <Kicker tone="muted">Telemetry</Kicker>
            <p className="text-sm text-slate-400">
              Invocation counts only — never prompts, never code. The sink is{" "}
              <span className="font-mono text-slate-200">{SINK_LABEL[view.telemetry.sink]}</span>.
            </p>
            <div className="font-mono text-sm text-slate-300">
              <span className="text-2xl font-bold tabular-nums text-white">{view.telemetry.invokes30d.toLocaleString()}</span> invokes ·
              30d
            </div>
            <div className="font-mono text-xs text-slate-500">
              from <span className="tabular-nums text-slate-300">{view.telemetry.reposReporting}</span> repos
            </div>
          </div>
        </section>
      ) : null}

      <RegistryActivity view={view} limit={10} />

      <RegistryHowTo view={view} />
    </div>
  );
}
