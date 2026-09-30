"use client";

// Indexed counts in paper. Migration state is a glyph and a word, never a score color.

import { Caption, CellMark, Frame, MonoPath, SectionHead, StatTile } from "@/components/kit";
import type { RegistryArtifact, RegistryView } from "@/lib/org/registry-view";
import { ARTIFACTS, ARTIFACT_DIR, ARTIFACT_LABEL } from "./registryModel";
import { migrationMark } from "./registryLadder";
import { RegistryMigrateV2 } from "./RegistryMigrate.v2";

function Cell({ view, artifact, slug }: { view: RegistryView; artifact: RegistryArtifact; slug: string }) {
  const c = view.counts[artifact];
  const step = view.migration[artifact];
  const total = c.registry + c.hostedOnly;
  const mark = migrationMark(step.state);
  const sub = c.hostedOnly > 0 ? `+${c.hostedOnly} hosted only` : total === 0 ? "nothing authored yet" : "all in the registry";
  return (
    <div className="space-y-2">
      <StatTile variant="figure" label={ARTIFACT_LABEL[artifact]} value={c.registry} sub={sub} />
      <div className="flex flex-wrap items-center gap-3">
        <MonoPath>{ARTIFACT_DIR[artifact]}</MonoPath>
        <CellMark state={mark.state}>{mark.word}</CellMark>
      </div>
      <RegistryMigrateV2 view={view} artifact={artifact} step={step} slug={slug} />
    </div>
  );
}

export function RegistryArtifacts({ view, slug }: { view: RegistryView; slug: string }) {
  return (
    <Frame>
      <SectionHead eyebrow="Artifact counts" title="Skills, practices," named="and memory." />
      <div className="mt-4 grid gap-6 sm:grid-cols-3">
        {ARTIFACTS.map((a) => (
          <Cell key={a} view={view} artifact={a} slug={slug} />
        ))}
      </div>
      {view.counts.lessons > 0 ? (
        <Caption className="mt-4">
          <span className="tabular-nums text-slate-200">{view.counts.lessons}</span> LESSONS.md entries appended by developers,
          reflection lane 2, append-only, never overwritten by ascent.
        </Caption>
      ) : null}
    </Frame>
  );
}
