"use client";

// DIRECTION 3 — "Pipeline / Journey".
//
// Metaphor: the registry is a CONVEYOR, and the tab is the plant floor watching it. Everything reads
// left to right — ascent → your registry → fleet repos → developers — with a counter on every hand-off
// and a return leg carrying invoke counts back. Onboarding is not a separate panel: the pipeline simply
// isn't lit yet, and each unlit stage carries the step that energizes it.
//
// Differs from Ledger (a page you read) and Blueprint (a machine you inspect) by being a THROUGHPUT
// surface: the top row is the flow, and everything below it is the flow's yield — stale edges,
// per-artifact counts, what moved recently.

import { Kicker, SectionHeading, Stat, Surface } from "@/components/ui";
import { TILE_LEDGER } from "@/components/org/shared/ui";
import { scoreHex, timeAgo } from "@/lib/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { MODE_LABEL, SINK_LABEL, registryVerdict, shortSha } from "./registryModel";
import { RegistryPipelineFlow } from "./RegistryPipelineFlow";
import { RegistryArtifactLedger } from "./RegistryArtifactLedger";
import { RegistryFleetSync } from "./RegistryFleetSync";
import { RegistryActivity } from "./RegistryActivity";
import { RegistryHowTo } from "./RegistryHowTo";
import { RegistryHeaderActions } from "./RegistryActions";

function ThroughputRow({ view }: { view: RegistryView }) {
  const { reposPointing, reposTotal, reposSynced30d, adoption } = view.fleet;
  const behind = adoption.stale + adoption.diverged;
  const pointPct = reposTotal === 0 ? 0 : Math.round((reposPointing / reposTotal) * 100);
  return (
    <div className={`${TILE_LEDGER} sm:grid-cols-2 lg:grid-cols-4`}>
      <div className="bg-ink px-5 py-3.5">
        <Stat label="Reach" value={`${pointPct}%`} sub={`${reposPointing}/${reposTotal} repos pointing`} color={scoreHex(pointPct)} />
      </div>
      <div className="bg-ink px-5 py-3.5">
        <Stat label="Synced 30d" value={reposSynced30d} sub={reposPointing === 0 ? "no pointing repos yet" : `of ${reposPointing} pointing`} />
      </div>
      <div className="bg-ink px-5 py-3.5">
        <Stat
          label="Behind the catalog"
          value={behind}
          sub={behind === 0 ? "nothing stale or diverged" : `${adoption.stale} stale · ${adoption.diverged} diverged`}
          color={behind > 0 ? "var(--color-warn)" : undefined}
        />
      </div>
      <div className="bg-ink px-5 py-3.5">
        <Stat
          label="Invokes 30d"
          value={view.telemetry.invokes30d}
          sub={`${view.telemetry.reposReporting} repos reporting · sink ${SINK_LABEL[view.telemetry.sink]}`}
        />
      </div>
    </div>
  );
}

export function RegistryPanelPipeline({ view, slug }: { view: RegistryView; slug: string }) {
  const mapped = view.status !== "unmapped";
  const r = view.registry;
  return (
    <div className="stagger-children space-y-6">
      <SectionHeading
        kicker={r ? `${r.fullName} · ${MODE_LABEL[r.mode]} · ${shortSha(r.lastIndexSha)}` : `${slug} · no registry yet`}
        title={mapped ? "From your registry to every repo" : "Nothing is flowing yet"}
        intro={registryVerdict(view)}
        right={mapped ? <RegistryHeaderActions view={view} slug={slug} /> : undefined}
      />

      {view.error ? (
        <p className="rounded-xl border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-warn">
          <span className="font-mono text-xs uppercase tracking-[0.18em]">the index edge is broken · {timeAgo(view.error.at)} · </span>
          {view.error.message}
        </p>
      ) : null}

      <RegistryPipelineFlow view={view} slug={slug} />

      {mapped ? <ThroughputRow view={view} /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <RegistryArtifactLedger view={view} slug={slug} heading="What is on the belt" />
          <RegistryActivity view={view} limit={8} />
        </div>
        <div className="space-y-6">
          <RegistryFleetSync view={view} slug={slug} />
          <Surface radius="xl" className="p-5">
            <RegistryHowTo view={view} />
          </Surface>
        </div>
      </div>

      {!mapped ? (
        <p className="text-sm text-slate-400">
          <Kicker tone="muted" as="span">
            Note ·{" "}
          </Kicker>
          Nothing above is a demand. A registry is worth it when more than one repo should share the same skill; until then, hosted is
          a fine place for {view.counts.skills.hostedOnly + view.counts.memory.hostedOnly} artifacts.
        </p>
      ) : null}
    </div>
  );
}
