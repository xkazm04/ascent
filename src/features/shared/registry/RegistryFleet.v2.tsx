// Pointing and sync are fractions with a mark. Unmeasured stays a void, never 0%.

import { Caption, CellMark, Frame, GhostAction, SectionHead, VoidMark, type CellState } from "@/components/kit";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { RegistryView } from "@/lib/org/registry-view";
import { RegistryRosterV2 } from "./RegistryRoster.v2";

function fractionState(n: number, total: number): CellState {
  if (total > 0 && n >= total) return "met";
  if (n > 0) return "partial";
  return "missing";
}

function Measure({
  label,
  measured,
  text,
  state,
  word,
}: {
  label: string;
  measured: boolean;
  text: string;
  state: CellState;
  word: string;
}) {
  return (
    <div className="py-2" data-fleet-meter={label} data-state={measured ? "measured" : "not-judged"}>
      <Caption>{label}</Caption>
      {measured ? (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span className="text-slate-100 tabular-nums">{text}</span>
          <CellMark state={state}>{word}</CellMark>
        </div>
      ) : (
        <div className="mt-1">
          <VoidMark subject={label} label="not measured" />
        </div>
      )}
    </div>
  );
}

const ADOPTION = [
  { key: "inSync", label: "in sync", state: "met" },
  { key: "stale", label: "stale", state: "partial" },
  { key: "diverged", label: "diverged", state: "missing" },
  { key: "localOnly", label: "local only", state: "partial" },
] as const;

export function RegistryFleetV2({ view, slug }: { view: RegistryView; slug: string }) {
  const { reposTotal, reposPointing, reposSynced30d, adoption } = view.fleet;
  const pointingMeasured = typeof reposPointing === "number";
  const syncedMeasured = typeof reposSynced30d === "number" && pointingMeasured;
  const reporting = view.telemetry.reposReporting;
  const adopted = adoption.inSync + adoption.stale + adoption.diverged + adoption.localOnly;
  return (
    <Frame>
      <SectionHead
        eyebrow="Fleet sync"
        title="Who points here,"
        named="and who synced."
        actions={<GhostAction href={orgTabHref(slug, "skills")}>Skills heatmap</GhostAction>}
      />
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Measure
          label="Pointing"
          measured={pointingMeasured}
          text={pointingMeasured ? `${reposPointing}/${reposTotal}` : ""}
          state={pointingMeasured ? fractionState(reposPointing, reposTotal) : "unmeasured"}
          word={pointingMeasured ? `${reposPointing} of ${reposTotal}` : ""}
        />
        <Measure
          label="Synced, 30 days"
          measured={syncedMeasured}
          text={syncedMeasured ? `${reposSynced30d}/${reposPointing}` : ""}
          state={syncedMeasured ? fractionState(reposSynced30d, reposPointing) : "unmeasured"}
          word={syncedMeasured ? `${reposSynced30d} of ${reposPointing}` : ""}
        />
        <Measure
          label="Reporting"
          measured
          text={`${reporting}/${reposTotal}`}
          state={fractionState(reporting, reposTotal)}
          word={`${reporting} of ${reposTotal}`}
        />
      </div>
      {pointingMeasured && view.fleet.roster ? (
        <RegistryRosterV2 roster={view.fleet.roster} unswept={view.fleet.unswept} pointer={view.howTo.pointer} />
      ) : null}
      {adopted === 0 ? (
        <div className="mt-4 space-y-2">
          <VoidMark subject="Adoption by hash" label="not measured" />
          <p className="type-body-sm text-slate-400">
            Adoption by hash (in_sync, stale, diverged, local_only) is not measured: no pass compares each repo&apos;s skills with
            the catalog yet.
          </p>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-4">
          {ADOPTION.map((s) => (
            <CellMark key={s.key} state={s.state}>
              {adoption[s.key]} {s.label}
            </CellMark>
          ))}
        </div>
      )}
    </Frame>
  );
}
