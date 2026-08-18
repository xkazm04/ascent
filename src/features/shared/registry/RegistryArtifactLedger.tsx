"use client";

// The three-artifact ledger — Skills · Practices · Memory as TILE_LEDGER cells, each reading
// "in registry vs hosted only" plus its migration state and the action that moves it. This is the
// Ledger direction's centerpiece and the Pipeline direction's registry stage, so it lives here rather
// than in either file. Client because the migration action is a button.

import { Kicker, Stat } from "@/components/ui";
import { TILE_LEDGER } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import type { RegistryArtifact, RegistryView } from "@/lib/org/registry-view";
import { ARTIFACTS, ARTIFACT_DIR, ARTIFACT_LABEL, MIGRATION_LABEL } from "./registryModel";
import { RegistryMigrateAction } from "./RegistryActions";

function Cell({ view, artifact, slug }: { view: RegistryView; artifact: RegistryArtifact; slug: string }) {
  const c = view.counts[artifact];
  const step = view.migration[artifact];
  const total = c.registry + c.hostedOnly;
  // The migration ramp is a genuine 0-100 completion, so the score ramp is the right color here.
  const pct = total === 0 ? 0 : Math.round((c.registry / total) * 100);
  return (
    <div className="bg-ink px-5 py-4">
      <Stat
        label={ARTIFACT_LABEL[artifact]}
        value={c.registry}
        sub={c.hostedOnly > 0 ? `+${c.hostedOnly} hosted only` : total === 0 ? "nothing authored yet" : "all in the registry"}
        color={total === 0 ? undefined : scoreHex(pct)}
      />
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-mono text-xs text-slate-600">{ARTIFACT_DIR[artifact]}</span>
        <span className="font-mono text-xs uppercase tracking-[0.16em] text-slate-500">{MIGRATION_LABEL[step.state]}</span>
      </div>
      <div className="mt-1">
        <RegistryMigrateAction view={view} artifact={artifact} step={step} slug={slug} />
      </div>
    </div>
  );
}

export function RegistryArtifactLedger({
  view,
  slug,
  heading = "The three artifacts",
}: {
  view: RegistryView;
  slug: string;
  heading?: string | null;
}) {
  return (
    <div className="space-y-2">
      {heading ? <Kicker tone="muted">{heading}</Kicker> : null}
      <div className={`${TILE_LEDGER} sm:grid-cols-3`}>
        {ARTIFACTS.map((a) => (
          <Cell key={a} view={view} artifact={a} slug={slug} />
        ))}
      </div>
      {view.counts.lessons > 0 ? (
        <p className="font-mono text-xs text-slate-500">
          <span className="tabular-nums text-slate-300">{view.counts.lessons}</span> LESSONS.md entries appended by developers —
          reflection lane 2, append-only, never overwritten by ascent.
        </p>
      ) : null}
    </div>
  );
}
