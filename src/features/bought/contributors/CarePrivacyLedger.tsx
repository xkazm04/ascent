// The care privacy ledger — an absence you can SEE.
//
// The Care section used to promise its guarantee in prose: "Counts of people who set the local mentor
// up and chose to share an aggregate — never who, and never a per-person row", plus "No row here is a
// person, and no view of this tab can name one." A promise is exactly the wrong shape for a privacy
// claim: the reader has to trust it, and prose cannot enforce it.
//
// So the guarantee is drawn. Every category the org aggregate carries gets a row, and the right-hand
// column — "per-person row" — is a column of VOIDS, all the way down. Nothing is drawn where an
// identity would be, because `CareOrgView` has no field that could hold one. The bottom rows are void
// on BOTH axes: transcripts, prompts and diffs are not merely un-aggregated, they never leave the
// developer's machine at all.
//
// Server-safe (MatrixGrid is the client component).

import { Kicker } from "@/components/ui";
import { MatrixGrid, WhyChip, type MatrixRow } from "@/components/org/viz";
import type { CareOrgView } from "@/lib/org/developer-view";

const LEDGER_HINT =
  "The right column is void by construction, not by absence of data: the org view model has no field " +
  "that could carry a login or a per-person row, so no view of this tab can name anyone.";

const FLOOR_HINT =
  "Below the floor an 'aggregate' would identify individuals, so every count is suppressed rather than " +
  "thinned — hatched here, never rendered as a zero.";

/** What the org aggregate counts, and what it structurally cannot. Order: counted first, never last. */
const COUNTED = [
  { id: "setup", label: "Mentor set-up" },
  { id: "sharing", label: "Aggregate share" },
  { id: "moves", label: "Moves kept" },
  { id: "asks", label: "Ask themes" },
  { id: "shape", label: "Shape bands" },
] as const;

const NEVER = [
  { id: "transcripts", label: "Transcripts" },
  { id: "prompts", label: "Prompts, diffs" },
  { id: "who", label: "Who kept what" },
] as const;

export function CarePrivacyLedger({ org }: { org: CareOrgView }) {
  // Suppressed is not absent: below the floor the counted column HATCHES (not judged, no value
  // printed) rather than going void, because the data exists and was deliberately withheld.
  const countedState = org.belowFloor ? ("not-judged" as const) : ("measured" as const);
  const rows: MatrixRow[] = [
    ...COUNTED.map((r) => ({ id: r.id, label: r.label, cells: [{ state: countedState }, { state: "missing" as const }] })),
    ...NEVER.map((r) => ({ id: r.id, label: r.label, cells: [{ state: "missing" as const }, { state: "missing" as const }] })),
  ];

  return (
    <div className="mt-3 rounded-xl border border-divider bg-surface/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Kicker tone="muted">
          floor {org.floor} developers · {org.population} in this workspace
        </Kicker>
        <span className="inline-flex items-center gap-2">
          {org.belowFloor && <WhyChip hint={FLOOR_HINT} label="why the counts are suppressed" align="end" />}
          <WhyChip hint={LEDGER_HINT} label="what this tab can never hold" align="end" />
        </span>
      </div>
      <MatrixGrid
        className="mt-2 max-w-sm"
        title="What this workspace's care aggregate holds"
        axes={["Counted here", "Per-person row"]}
        rows={rows}
      />
    </div>
  );
}
