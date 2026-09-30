"use client";

// The library, grouped by the dimension each practice lifts. One hairline frame, not a card matrix.
import { useMemo, useState } from "react";
import {
  Caption, DimensionLine, Display, Frame, HairlineList, Lede, Movement, PrimaryAction, SectionHead, Segmented, VoidMark, parseDimension,
} from "@/components/kit";
import { DIMENSION_SHORT } from "@/lib/ui";
import type { DimensionId } from "@/lib/types";
import { groupReadout, rolloutGroups, type RolloutSource } from "./practiceRolloutGroups";
import { rolloutIsMeaningful, type PracticeRollout, type PracticeRow } from "./practiceRows";
import { rolloutScopeLine } from "./practiceRolloutViz";
import { PracticeRowV2 } from "./PracticeRow.v2";

const SOURCES: { key: RolloutSource; label: string }[] = [
  { key: "all", label: "All" },
  { key: "authored", label: "Authored" },
  { key: "mined", label: "Mined" },
];

const NOTHING =
  "Nothing has rolled out yet. Applying a practice opens a draft pull request the target repo's own reviewers approve; the lift it produced is measured only once a scan lands on the far side of the merge.";

function Lift({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div>
      <Caption>{label}</Caption>
      {value == null ? (
        <span className="mt-1 flex items-center gap-2 text-slate-400">
          <VoidMark label={`${label}: not measured`} />
          not measured
        </span>
      ) : value === 0 ? (
        <Display as="div" level="figure">0</Display>
      ) : (
        <Movement delta={value} basis={unit} toneClass={() => "text-slate-100"} />
      )}
      {value != null && <Caption>{unit}</Caption>}
    </div>
  );
}

export function PracticeLibraryV2({
  rows,
  rollout,
  fleetSize,
  onOpen,
  onCreate,
}: {
  rows: readonly PracticeRow[];
  rollout: PracticeRollout;
  fleetSize: number;
  onOpen: (row: PracticeRow) => void;
  onCreate: () => void;
}) {
  const [source, setSource] = useState<RolloutSource>("all");
  const groups = useMemo(() => rolloutGroups(rows, fleetSize, source), [rows, fleetSize, source]);
  const mixed = rows.some((r) => r.source === "authored") && rows.some((r) => r.source === "mined");
  const shown = groups.reduce((n, g) => n + g.entries.length, 0);

  return (
    <Frame>
      <SectionHead
        id="practice-library-title"
        eyebrow="Practice library"
        title={rows.length === 0 ? "No practices yet." : "Grouped by the dimension"}
        named={rows.length === 0 ? undefined : "each one lifts."}
        lede={rows.length === 0 ? undefined : rolloutScopeLine(shown, rows.length, fleetSize)}
        actions={
          <>
            {mixed && (
              <Segmented
                label="Filter by source"
                variant="soft"
                options={SOURCES}
                value={source}
                onSelect={(key) => setSource(key as RolloutSource)}
              />
            )}
            <PrimaryAction onClick={onCreate}>New practice</PrimaryAction>
          </>
        }
      />
      {rows.length === 0 ? (
        <Lede className="mt-4">No practices yet. Author one with New practice, or scan this org&apos;s repos to mine some.</Lede>
      ) : (
        <div className="mt-6 space-y-8">
          {groups.map((g) => {
            const dim = parseDimension(g.dimId);
            const name = DIMENSION_SHORT[g.dimId as DimensionId] ?? g.label;
            return (
              <div key={g.dimId}>
                {dim ? (
                  <DimensionLine
                    wide
                    dimension={dim}
                    label={name}
                    value={g.adopted == null ? null : g.adopted / 100}
                    display={g.adopted == null ? "not measured" : `${g.adopted}%`}
                    detail={groupReadout(g)}
                  />
                ) : (
                  <Caption>{groupReadout(g)}</Caption>
                )}
                <HairlineList>
                  {g.entries.map((entry) => (
                    <li key={entry.row.key}>
                      <PracticeRowV2 entry={entry} onOpen={onOpen} />
                    </li>
                  ))}
                </HairlineList>
              </div>
            );
          })}
        </div>
      )}
      {rows.length > 0 && (
        rolloutIsMeaningful(rollout) ? (
          <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-t border-divider pt-4">
            <div>
              <Caption>Repos adopting</Caption>
              <Display as="div" level="figure">{rollout.adoptingRepos}</Display>
              <Caption>{rollout.playbooksAdopted} playbook{rollout.playbooksAdopted === 1 ? "" : "s"}</Caption>
            </div>
            <div>
              <Caption>Starter PRs</Caption>
              <Display as="div" level="figure">{rollout.prsMerged}</Display>
              <Caption>landed, {rollout.prsOpen} in flight</Caption>
            </div>
            <Lift label="Playbook lift" value={rollout.playbookLift} unit={`${rollout.playbookMeasured} adoptions`} />
            <Lift label="Practice PR lift" value={rollout.practiceLift} unit={`${rollout.practiceLiftSources} practices`} />
          </div>
        ) : (
          <Lede className="mt-6">{NOTHING}</Lede>
        )
      )}
    </Frame>
  );
}
